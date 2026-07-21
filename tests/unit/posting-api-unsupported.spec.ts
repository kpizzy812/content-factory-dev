/**
 * Unit-тесты: прод-ветка postingMethod=api честно валит job терминально
 * (без фейкового «published» с mock-post URL).
 *
 * Проверяем:
 *   1. ApiPostingUnsupportedError → categorizeError возвращает терминальную категорию
 *      internal_error (НЕ retryable).
 *   2. shouldRetry(category) === false — job НЕ зациклится в retry.
 *   3. Сообщение ошибки НЕ матчит retryable-паттерны (proxy/timeout/network),
 *      т.е. даже без structured category классификатор не вернул бы retryable.
 */
import { describe, expect, it } from "vitest"
import {
  ApiPostingUnsupportedError,
  categorizeError,
} from "../../server/utils/posting/error-classifier"
import {
  POSTING_RETRYABLE_CATEGORIES,
  shouldRetry,
} from "../../server/utils/posting/state-machine"

const API_MSG =
  "API-постинг не реализован (postingMethod=api, реального API-раннера нет). "
  + "Переключите аккаунт на browser_automation („Через браузер“) "
  + "+ привяжите прокси/Indigo + залогиньтесь."

describe("ApiPostingUnsupportedError — прод-ветка api честно валит терминально", () => {
  it("categorizeError → internal_error (терминальная)", () => {
    const err = new ApiPostingUnsupportedError(API_MSG)
    expect(categorizeError(err)).toBe("internal_error")
  })

  it("internal_error НЕ входит в RETRYABLE_CATEGORIES", () => {
    expect(POSTING_RETRYABLE_CATEGORIES).not.toContain("internal_error")
  })

  it("shouldRetry === false даже при attemptCount < maxAttempts (нет зацикливания)", () => {
    const err = new ApiPostingUnsupportedError(API_MSG)
    const category = categorizeError(err)
    expect(shouldRetry(category, 1, 3)).toBe(false)
    expect(shouldRetry(category, 0, 10)).toBe(false)
  })

  it("сообщение НЕ матчит retryable-паттерны (даже как plain Error → не network/proxy/timeout)", () => {
    // Без structured category: проверяем что текст сам по себе не уводит в retryable.
    const plain = categorizeError(new Error(API_MSG))
    expect(POSTING_RETRYABLE_CATEGORIES).not.toContain(plain)
    // Конкретно: не proxy_dead / network_error / platform_5xx / rate_limit.
    expect(plain).not.toBe("proxy_dead")
    expect(plain).not.toBe("network_error")
  })

  it("несёт category=internal_error и корректное имя", () => {
    const err = new ApiPostingUnsupportedError(API_MSG)
    expect(err.category).toBe("internal_error")
    expect(err.name).toBe("ApiPostingUnsupportedError")
    expect(err).toBeInstanceOf(Error)
  })
})
