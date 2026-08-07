/**
 * Политика автоповторов официальной публикации.
 * Дефект: failed-загрузки не повторялись вообще, а blocked_by_env висели вечно.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import {
  MAX_UPLOAD_ATTEMPTS,
  isPermanentUploadError,
  planUploadRetry,
  uploadRetryDelayMs,
} from "~~/server/utils/upload-retry-policy"

const NOW = new Date("2026-08-07T12:00:00.000Z")

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000)
}

describe("isPermanentUploadError", () => {
  it("считает терминальными ошибки, которые повтор не чинит", () => {
    const permanent = [
      "Аккаунт Reforma IG не подключён через официальный OAuth. Переподключите аккаунт на странице аккаунтов.",
      "Instagram account Reforma has no OAuth token. Reconnect it through Instagram OAuth.",
      "TikTok аккаунт X: создан вручную (manual), OAuth-токены отсутствуют.",
      "YouTube аккаунт X: отсутствует refresh token",
      "Instagram OAuth token expired; reconnect the account.",
      "Аккаунт Reforma IG неактивен (expired)",
      "Instagram caption exceeds 2200 characters (2401)",
      "Видео 12 не имеет сохранённого файла для загрузки",
      "Upload 12 не найден",
      "Публикация отключена (ENABLE_SOCIAL_POSTING=false). Платформа: instagram",
    ]
    for (const message of permanent) {
      expect(isPermanentUploadError(message), message).toBe(true)
    }
  })

  it("не трогает транзиентные сбои", () => {
    const transient = [
      "fetch failed",
      "Instagram API: 500 Internal Server Error",
      "Request timed out after 30000ms",
      "socket hang up",
    ]
    for (const message of transient) {
      expect(isPermanentUploadError(message), message).toBe(false)
    }
    expect(isPermanentUploadError(null)).toBe(false)
    expect(isPermanentUploadError("")).toBe(false)
  })
})

describe("uploadRetryDelayMs", () => {
  it("растёт по 5 / 15 / 60 минут и дальше не увеличивается", () => {
    expect(uploadRetryDelayMs(0)).toBe(5 * 60_000)
    expect(uploadRetryDelayMs(1)).toBe(5 * 60_000)
    expect(uploadRetryDelayMs(2)).toBe(15 * 60_000)
    expect(uploadRetryDelayMs(3)).toBe(60 * 60_000)
    expect(uploadRetryDelayMs(9)).toBe(60 * 60_000)
  })
})

describe("planUploadRetry", () => {
  it("повторяет транзиентный сбой после выдержки backoff", () => {
    const decision = planUploadRetry(
      { attemptCount: 1, lastAttemptAt: minutesAgo(6), errorMessage: "fetch failed" },
      NOW,
    )
    expect(decision).toEqual({ retry: true, attempt: 2 })
  })

  it("держит паузу, пока backoff не истёк", () => {
    const decision = planUploadRetry(
      { attemptCount: 1, lastAttemptAt: minutesAgo(2), errorMessage: "fetch failed" },
      NOW,
    )
    expect(decision.retry).toBe(false)
    expect(decision).toMatchObject({ reason: "backoff" })
  })

  it("для второй попытки ждёт уже 15 минут", () => {
    const tooEarly = planUploadRetry(
      { attemptCount: 2, lastAttemptAt: minutesAgo(10), errorMessage: "socket hang up" },
      NOW,
    )
    expect(tooEarly).toMatchObject({ retry: false, reason: "backoff" })

    const ready = planUploadRetry(
      { attemptCount: 2, lastAttemptAt: minutesAgo(16), errorMessage: "socket hang up" },
      NOW,
    )
    expect(ready).toEqual({ retry: true, attempt: 3 })
  })

  it("не повторяет терминальную ошибку даже на первой попытке", () => {
    const decision = planUploadRetry(
      {
        attemptCount: 0,
        lastAttemptAt: null,
        errorMessage: "Instagram caption exceeds 2200 characters (2401)",
      },
      NOW,
    )
    expect(decision).toEqual({ retry: false, reason: "permanent_error" })
  })

  it("останавливается на лимите попыток", () => {
    const decision = planUploadRetry(
      {
        attemptCount: MAX_UPLOAD_ATTEMPTS,
        lastAttemptAt: minutesAgo(600),
        errorMessage: "fetch failed",
      },
      NOW,
    )
    expect(decision).toEqual({ retry: false, reason: "attempts_exhausted" })
  })

  it("без lastAttemptAt пробует сразу (попытка не дошла до старта пайплайна)", () => {
    const decision = planUploadRetry(
      { attemptCount: 0, lastAttemptAt: null, errorMessage: "fetch failed" },
      NOW,
    )
    expect(decision).toEqual({ retry: true, attempt: 1 })
  })
})
