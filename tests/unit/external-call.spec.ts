/**
 * Unit-тесты withTimeoutAndRetry — universal wrapper для external API calls.
 *
 * Покрывает:
 *   1. Successful first attempt — нет retry, нет timeout
 *   2. Transient error → retry → eventual success
 *   3. Hard timeout fires — operation отваливается за timeoutMs
 *   4. Non-retryable errors (401/403/422/exhausted) — fail immediately
 *   5. Max retries exhausted — throw aggregated error с label
 *   6. Backoff growth — exponential delay между retries
 *   7. onAttempt / onRetry callbacks
 */
import { describe, expect, it, vi } from "vitest"
import { withTimeoutAndRetry, isNonRetryableError } from "../../server/utils/external-call"

describe("withTimeoutAndRetry", () => {
  it("успешная первая попытка → no retry, no timeout", async () => {
    const op = vi.fn().mockResolvedValue("ok")
    const onAttempt = vi.fn()
    const onRetry = vi.fn()

    const result = await withTimeoutAndRetry(op, {
      label: "test",
      timeoutMs: 1000,
      maxRetries: 3,
      onAttempt,
      onRetry,
    })

    expect(result).toBe("ok")
    expect(op).toHaveBeenCalledTimes(1)
    expect(onAttempt).toHaveBeenCalledTimes(1)
    expect(onAttempt).toHaveBeenCalledWith(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("transient error → retry → eventual success", async () => {
    let calls = 0
    const op = vi.fn().mockImplementation(async () => {
      calls++
      if (calls < 3) throw new Error("transient network error")
      return "recovered"
    })

    const onRetry = vi.fn()
    const result = await withTimeoutAndRetry(op, {
      label: "test",
      timeoutMs: 1000,
      maxRetries: 5,
      initialBackoffMs: 10,
      onRetry,
    })

    expect(result).toBe("recovered")
    expect(op).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it("hard timeout срабатывает когда operation висит", async () => {
    const op = vi.fn().mockImplementation(() => new Promise(() => { /* never resolves */ }))

    await expect(
      withTimeoutAndRetry(op, {
        label: "hanging-op",
        timeoutMs: 50,
        maxRetries: 1,
      }),
    ).rejects.toThrow(/hanging-op timeout after 50ms/)
  })

  it("hard timeout с retry — все попытки таймаутят → final error с label", async () => {
    const op = vi.fn().mockImplementation(() => new Promise(() => { /* never resolves */ }))

    await expect(
      withTimeoutAndRetry(op, {
        label: "always-hangs",
        timeoutMs: 30,
        maxRetries: 3,
        initialBackoffMs: 5,
      }),
    ).rejects.toThrow(/always-hangs failed after 3 attempt/)

    expect(op).toHaveBeenCalledTimes(3)
  })

  it("non-retryable error (401) → fail immediately без retry", async () => {
    const authError = Object.assign(new Error("Unauthorized"), {
      response: { status: 401 },
      statusCode: 401,
    })
    const op = vi.fn().mockRejectedValue(authError)

    await expect(
      withTimeoutAndRetry(op, {
        label: "test",
        timeoutMs: 1000,
        maxRetries: 5,
      }),
    ).rejects.toBe(authError)

    expect(op).toHaveBeenCalledTimes(1) // НЕ retry
  })

  it("non-retryable error (403) → fail immediately", async () => {
    const forbidden = Object.assign(new Error("Forbidden"), {
      response: { status: 403 },
    })
    const op = vi.fn().mockRejectedValue(forbidden)

    await expect(withTimeoutAndRetry(op, {
      label: "test",
      timeoutMs: 1000,
      maxRetries: 3,
    })).rejects.toBe(forbidden)

    expect(op).toHaveBeenCalledTimes(1)
  })

  it("non-retryable error (422) → fail immediately", async () => {
    const invalid = Object.assign(new Error("Invalid params"), { statusCode: 422 })
    const op = vi.fn().mockRejectedValue(invalid)

    await expect(withTimeoutAndRetry(op, {
      label: "test",
      timeoutMs: 1000,
      maxRetries: 3,
    })).rejects.toBe(invalid)

    expect(op).toHaveBeenCalledTimes(1)
  })

  it("exhausted balance message → fail immediately", async () => {
    const budgetError = new Error("💰 Баланс fal.ai исчерпан. User is locked.")
    const op = vi.fn().mockRejectedValue(budgetError)

    await expect(withTimeoutAndRetry(op, {
      label: "test",
      timeoutMs: 1000,
      maxRetries: 5,
    })).rejects.toBe(budgetError)

    expect(op).toHaveBeenCalledTimes(1)
  })

  it("max retries exhausted → aggregated error с label + cause", async () => {
    const innerError = new Error("network failed")
    const op = vi.fn().mockRejectedValue(innerError)

    let caught: unknown
    try {
      await withTimeoutAndRetry(op, {
        label: "myop",
        timeoutMs: 1000,
        maxRetries: 3,
        initialBackoffMs: 5,
      })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/myop failed after 3 attempt/)
    expect((caught as Error).message).toContain("network failed")
    expect(op).toHaveBeenCalledTimes(3)
  })

  it("exponential backoff растёт от попытки к попытке", async () => {
    const delays: number[] = []
    const op = vi.fn().mockRejectedValue(new Error("transient"))

    await expect(withTimeoutAndRetry(op, {
      label: "test",
      timeoutMs: 1000,
      maxRetries: 4,
      initialBackoffMs: 10,
      backoffMultiplier: 2,
      onRetry: (_attempt, _err, delayMs) => delays.push(delayMs),
    })).rejects.toThrow()

    // 4 попытки → 3 backoff'a: 10, 20, 40
    expect(delays).toEqual([10, 20, 40])
  })

  it("backoff capped maxBackoffMs", async () => {
    const delays: number[] = []
    const op = vi.fn().mockRejectedValue(new Error("transient"))

    await expect(withTimeoutAndRetry(op, {
      label: "test",
      timeoutMs: 1000,
      maxRetries: 5,
      initialBackoffMs: 1000,
      backoffMultiplier: 10,
      maxBackoffMs: 5000,
      onRetry: (_attempt, _err, delayMs) => delays.push(delayMs),
    })).rejects.toThrow()

    // 1000, 5000 (capped), 5000 (capped), 5000 (capped)
    expect(delays).toEqual([1000, 5000, 5000, 5000])
  })

  it("maxRetries=1 → ровно одна попытка без retry", async () => {
    const op = vi.fn().mockRejectedValue(new Error("fail"))

    await expect(withTimeoutAndRetry(op, {
      label: "single-shot",
      timeoutMs: 1000,
      maxRetries: 1,
    })).rejects.toThrow(/single-shot failed after 1 attempt/)

    expect(op).toHaveBeenCalledTimes(1)
  })

  it("operation получает attempt number", async () => {
    const attempts: number[] = []
    let calls = 0
    const op = vi.fn().mockImplementation(async (attempt: number) => {
      attempts.push(attempt)
      calls++
      if (calls < 3) throw new Error("retry me")
      return "done"
    })

    await withTimeoutAndRetry(op, {
      label: "test",
      timeoutMs: 1000,
      maxRetries: 5,
      initialBackoffMs: 5,
    })

    expect(attempts).toEqual([1, 2, 3])
  })
})

describe("isNonRetryableError", () => {
  it("401 response → non-retryable", () => {
    const err = Object.assign(new Error("unauthorized"), { response: { status: 401 } })
    expect(isNonRetryableError(err)).toBe(true)
  })

  it("403 response → non-retryable", () => {
    const err = Object.assign(new Error("forbidden"), { response: { status: 403 } })
    expect(isNonRetryableError(err)).toBe(true)
  })

  it("422 response → non-retryable", () => {
    const err = Object.assign(new Error("invalid"), { statusCode: 422 })
    expect(isNonRetryableError(err)).toBe(true)
  })

  it("500 response → retryable", () => {
    const err = Object.assign(new Error("server error"), { response: { status: 500 } })
    expect(isNonRetryableError(err)).toBe(false)
  })

  it("429 rate limit → retryable", () => {
    const err = Object.assign(new Error("rate limit"), { response: { status: 429 } })
    expect(isNonRetryableError(err)).toBe(false)
  })

  it("network timeout → retryable (no status)", () => {
    const err = new Error("socket hang up")
    expect(isNonRetryableError(err)).toBe(false)
  })

  it("exhausted balance message → non-retryable", () => {
    expect(isNonRetryableError(new Error("💰 Баланс fal.ai исчерпан."))).toBe(true)
    expect(isNonRetryableError(new Error("Exhausted balance, please top up"))).toBe(true)
    expect(isNonRetryableError(new Error("Insufficient credit on account"))).toBe(true)
  })

  it("invalid api key message → non-retryable", () => {
    expect(isNonRetryableError(new Error("API-ключ невалиден или истёк"))).toBe(true)
    expect(isNonRetryableError(new Error("Invalid API key provided"))).toBe(true)
  })

  it("non-error value → retryable (safe default)", () => {
    expect(isNonRetryableError(null)).toBe(false)
    expect(isNonRetryableError(undefined)).toBe(false)
    expect(isNonRetryableError("string error")).toBe(false)
    expect(isNonRetryableError(42)).toBe(false)
  })

  it("plain object без response.status → retryable", () => {
    expect(isNonRetryableError({ foo: "bar" })).toBe(false)
  })
})
