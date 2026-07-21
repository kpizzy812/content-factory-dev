/**
 * Universal retry wrapper для storage-операций. Сетевые ошибки и 5xx/429
 * — retryable, всё остальное (404, PrefixGuard, INVALID_KEY) — fail-fast.
 *
 * Exponential backoff с base 1s, factor 2, cap 8s. Максимум 3 попытки —
 * больше не имеет смысла, GCS латентность для retryable классов
 * восстанавливается секунды-минуты, а pipeline'ы предпочитают
 * fail-soft и retry на уровне step'а.
 */
import { StorageError } from "./types"

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  factor?: number
}

const DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  factor: 2,
}

const RETRYABLE_NODE_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
])

function isRetryable(err: unknown): boolean {
  if (err instanceof StorageError) return err.retryable
  if (err && typeof err === "object") {
    const e = err as { code?: string; status?: number; statusCode?: number }
    if (e.code && RETRYABLE_NODE_CODES.has(e.code)) return true
    const status = e.status ?? e.statusCode
    if (status === 429) return true
    if (typeof status === "number" && status >= 500 && status < 600) return true
  }
  return false
}

export async function withRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, factor } = { ...DEFAULTS, ...opts }

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const retryable = isRetryable(err)
      console.warn(
        `[storage-retry] ${operation} attempt ${attempt}/${maxAttempts} failed`,
        { retryable, err: err instanceof Error ? err.message : String(err) },
      )
      if (!retryable || attempt === maxAttempts) throw err
      const delay = Math.min(baseDelayMs * Math.pow(factor, attempt - 1), maxDelayMs)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastErr
}
