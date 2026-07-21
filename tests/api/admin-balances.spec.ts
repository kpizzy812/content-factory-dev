/**
 * API contract-тесты для /api/admin/balances (balance_v2 Этап 4).
 *
 * Проверяем:
 *  1. GET 200 + структура ответа (services array, обязательные поля)
 *  2. GET 403 для non-admin
 *  3. PUT 200 valid amount для fal.ai
 *  4. PUT 400 unknown service (message содержит 'apify')
 *  5. PUT 400 negative amount (zod validation)
 *  6. PUT 403 для non-admin
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

interface BalancesGetResponse {
  data: {
    services: Array<{
      key: string
      label: string
      defaultCurrency: string
      lowThreshold: number
      criticalThreshold: number
      balance: unknown | null
    }>
  }
}

interface BalancesPutResponse {
  data: {
    id: number
    service: string
    amount: number
    currency: string
    notes: string | null
    enteredAt: string
    enteredBy: number | null
  }
}

describe("GET /api/admin/balances", () => {
  it("200 + правильная структура для admin", async () => {
    const admin = await createTestUser({ canAdmin: true })

    const res = await $fetch<BalancesGetResponse>("/api/admin/balances", {
      headers: authHeaders(admin.id),
    })

    expect(res.data).toBeDefined()
    expect(Array.isArray(res.data.services)).toBe(true)
    expect(res.data.services.length).toBeGreaterThanOrEqual(6)

    const fal = res.data.services.find(s => s.key === "fal.ai")
    expect(fal).toBeDefined()
    expect(typeof fal!.key).toBe("string")
    expect(typeof fal!.label).toBe("string")
    expect(typeof fal!.defaultCurrency).toBe("string")
    expect(typeof fal!.lowThreshold).toBe("number")
    expect(typeof fal!.criticalThreshold).toBe("number")
    // balance может быть null или объектом
    expect("balance" in fal!).toBe(true)
  })

  it("403 для non-admin (canAdmin=false)", async () => {
    const user = await createTestUser({ canAdmin: false, canRead: true })

    let status: number | null = null
    try {
      await $fetch("/api/admin/balances", {
        headers: authHeaders(user.id),
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number }
      status = e.statusCode ?? e.status ?? null
    }

    expect(status).toBe(403)
  })
})

describe("PUT /api/admin/balances/[service]", () => {
  it("200 + корректный ответ при valid amount для fal.ai", async () => {
    const admin = await createTestUser({ canAdmin: true })

    const res = await $fetch<BalancesPutResponse>("/api/admin/balances/fal.ai", {
      method: "PUT",
      headers: authHeaders(admin.id),
      body: { amount: 50, currency: "USD" },
    })

    expect(res.data).toBeDefined()
    expect(res.data.service).toBe("fal.ai")
    expect(res.data.amount).toBe(50)
    expect(res.data.currency).toBe("USD")
    expect(typeof res.data.enteredAt).toBe("string")
  })

  it("400 для неизвестного сервиса — message содержит 'apify'", async () => {
    const admin = await createTestUser({ canAdmin: true })

    let statusMessage: string | undefined
    let statusCode: number | null = null
    try {
      await $fetch("/api/admin/balances/unknown-svc", {
        method: "PUT",
        headers: authHeaders(admin.id),
        body: { amount: 10 },
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; statusMessage?: string; message?: string }
      statusCode = e.statusCode ?? e.status ?? null
      statusMessage = e.statusMessage ?? e.message ?? ""
    }

    expect(statusCode).toBe(400)
    expect(statusMessage).toContain("apify")
  })

  it("400 при отрицательной сумме (zod validation)", async () => {
    const admin = await createTestUser({ canAdmin: true })

    let statusCode: number | null = null
    try {
      await $fetch("/api/admin/balances/fal.ai", {
        method: "PUT",
        headers: authHeaders(admin.id),
        body: { amount: -1 },
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number }
      statusCode = e.statusCode ?? e.status ?? null
    }

    expect(statusCode).toBe(400)
  })

  it("403 для non-admin при PUT", async () => {
    const user = await createTestUser({ canAdmin: false, canRead: true, canWrite: true })

    let statusCode: number | null = null
    try {
      await $fetch("/api/admin/balances/fal.ai", {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { amount: 50 },
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number }
      statusCode = e.statusCode ?? e.status ?? null
    }

    expect(statusCode).toBe(403)
  })
})
