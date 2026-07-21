/**
 * Unit-тесты FalApiBalanceProvider.
 *
 * Mock-стратегия:
 *  - `$fetch` стабится через `vi.stubGlobal("$fetch", fn)` — провайдер вызывает
 *    глобальный $fetch (он в Nuxt-окружении автоимпортируется, в unit-vitest
 *    его просто нет).
 *  - Manual fallback читает реальную тестовую БД (TRUNCATE в afterEach из
 *    setup.ts → запись отсутствует → ManualBalanceProvider вернёт status
 *    "unknown", его мы потом перепишем на source: "fallback").
 *  - .env.test по умолчанию: FAL_KEY="" и FAL_MOCK_MODE=true. В каждом тесте
 *    явно выставляем нужные значения и восстанавливаем в afterEach.
 *
 * Кейсы (план §7):
 *  1. 200 OK + current_balance=50 → source='api', amount=50, status='ok'
 *  2. 200 OK + missing credits → source='fallback', reason "не вернул поля"
 *  3. 401 Unauthorized → source='fallback', reason содержит "Fal API"
 *  4. Timeout / network → source='fallback', reason содержит "Fal API"
 *  5. Нет FAL_KEY (mock OFF) → source='fallback', $fetch НЕ вызывается
 *  6. FAL_MOCK_MODE=true → source='fallback', $fetch НЕ вызывается
 *  7. Negative balance → amount=0 (Math.max), status='critical'
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FalApiBalanceProvider } from "../../server/utils/balance/providers/fal-api-provider"
import { getServiceConfig } from "../../server/utils/balance/config"

const cfg = getServiceConfig("fal.ai")!

// Сохраняем оригинальное значение env, чтобы каждый тест мог его менять
// без влияния на соседей.
const ORIGINAL_FAL_KEY = process.env.FAL_KEY
const ORIGINAL_FAL_MOCK_MODE = process.env.FAL_MOCK_MODE

function setEnv(values: { FAL_KEY?: string; FAL_MOCK_MODE?: string }): void {
  if (values.FAL_KEY === undefined) delete process.env.FAL_KEY
  else process.env.FAL_KEY = values.FAL_KEY

  if (values.FAL_MOCK_MODE === undefined) delete process.env.FAL_MOCK_MODE
  else process.env.FAL_MOCK_MODE = values.FAL_MOCK_MODE
}

function restoreEnv(): void {
  if (ORIGINAL_FAL_KEY === undefined) delete process.env.FAL_KEY
  else process.env.FAL_KEY = ORIGINAL_FAL_KEY

  if (ORIGINAL_FAL_MOCK_MODE === undefined) delete process.env.FAL_MOCK_MODE
  else process.env.FAL_MOCK_MODE = ORIGINAL_FAL_MOCK_MODE
}

describe("FalApiBalanceProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    restoreEnv()
  })

  it("200 OK with current_balance=50 → source=api, status=ok", async () => {
    setEnv({ FAL_KEY: "test-fal-key", FAL_MOCK_MODE: "false" })

    const fetchSpy = vi.fn().mockResolvedValue({
      username: "tester",
      credits: { current_balance: 50, currency: "USD" },
    })
    vi.stubGlobal("$fetch", fetchSpy)

    const result = await new FalApiBalanceProvider(cfg).fetchBalance()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.fal.ai/v1/account/billing")
    expect(opts.query).toEqual({ expand: "credits" })
    expect(opts.headers).toEqual({ Authorization: "Key test-fal-key" })
    expect(opts.timeout).toBe(5000)

    expect(result.source).toBe("api")
    expect(result.status).toBe("ok") // 50 > lowThreshold=5
    expect(result.balance).toEqual({ currency: "USD", amount: 50 })
    expect(result.service).toBe("fal.ai")
    expect(result.lowThreshold).toBe(cfg.lowThreshold)
    expect(result.criticalThreshold).toBe(cfg.criticalThreshold)
    expect(result.metadata?.username).toBe("tester")
    expect(result.metadata?.rawCurrentBalance).toBe(50)
  })

  it("200 OK but credits field missing → source=fallback, reason contains 'не вернул поля'", async () => {
    setEnv({ FAL_KEY: "test-fal-key", FAL_MOCK_MODE: "false" })

    const fetchSpy = vi.fn().mockResolvedValue({ username: "tester" })
    vi.stubGlobal("$fetch", fetchSpy)

    const result = await new FalApiBalanceProvider(cfg).fetchBalance()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.source).toBe("fallback")
    expect(result.notes ?? "").toContain("не вернул поля")
    expect(result.notes ?? "").toContain("credits.current_balance")
  })

  it("401 Unauthorized → source=fallback, reason contains 'Fal API'", async () => {
    setEnv({ FAL_KEY: "bad-key", FAL_MOCK_MODE: "false" })

    const err: Error & { status?: number } = new Error("Unauthorized")
    err.status = 401
    const fetchSpy = vi.fn().mockRejectedValue(err)
    vi.stubGlobal("$fetch", fetchSpy)

    const result = await new FalApiBalanceProvider(cfg).fetchBalance()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.source).toBe("fallback")
    expect(result.notes ?? "").toContain("Fal API")
    expect(result.notes ?? "").toContain("Unauthorized")
  })

  it("Network timeout → source=fallback, reason contains 'Fal API'", async () => {
    setEnv({ FAL_KEY: "test-fal-key", FAL_MOCK_MODE: "false" })

    const err = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    })
    const fetchSpy = vi.fn().mockRejectedValue(err)
    vi.stubGlobal("$fetch", fetchSpy)

    const result = await new FalApiBalanceProvider(cfg).fetchBalance()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.source).toBe("fallback")
    expect(result.notes ?? "").toContain("Fal API")
  })

  it("No FAL_KEY in env → source=fallback, $fetch NOT called", async () => {
    setEnv({ FAL_KEY: undefined, FAL_MOCK_MODE: "false" })

    const fetchSpy = vi.fn()
    vi.stubGlobal("$fetch", fetchSpy)

    const result = await new FalApiBalanceProvider(cfg).fetchBalance()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.source).toBe("fallback")
    expect(result.notes ?? "").toContain("FAL_KEY не настроен")
  })

  it("FAL_MOCK_MODE=true → source=fallback, $fetch NOT called (mock guard)", async () => {
    // Даже при наличии FAL_KEY mock-mode имеет приоритет.
    setEnv({ FAL_KEY: "test-fal-key", FAL_MOCK_MODE: "true" })

    const fetchSpy = vi.fn()
    vi.stubGlobal("$fetch", fetchSpy)

    const result = await new FalApiBalanceProvider(cfg).fetchBalance()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.source).toBe("fallback")
    expect(result.notes ?? "").toContain("FAL_MOCK_MODE")
  })

  it("Negative current_balance → amount=0 (Math.max), status=critical", async () => {
    setEnv({ FAL_KEY: "test-fal-key", FAL_MOCK_MODE: "false" })

    const fetchSpy = vi.fn().mockResolvedValue({
      username: "tester",
      credits: { current_balance: -3.5, currency: "USD" },
    })
    vi.stubGlobal("$fetch", fetchSpy)

    const result = await new FalApiBalanceProvider(cfg).fetchBalance()

    expect(result.source).toBe("api")
    expect(result.balance?.amount).toBe(0)
    expect(result.status).toBe("critical") // 0 <= criticalThreshold=1
    expect(result.metadata?.rawCurrentBalance).toBe(-3.5)
  })
})
