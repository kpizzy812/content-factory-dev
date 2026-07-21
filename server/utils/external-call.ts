/**
 * Universal wrapper для external API calls с hard timeout + structured retry.
 *
 * Проблема: pipeline #17 завис на TTS Scene 5 (Kokoro fal.ai). Перезапуск починил,
 * но это системная хрупкость — если HTTP socket к external API виснет без response,
 * pipeline ждёт бесконечно. `falPollUntilDone` имеет верхний лимит 20 мин на loop,
 * но одиночный fetch внутри loop без timeout может висеть навсегда → лимит loop'а
 * никогда не достигается.
 *
 * Решение: `withTimeoutAndRetry` гарантирует что любая операция завершится за
 * `timeoutMs × maxRetries + backoffs` секунд максимум, не виснет навсегда. На
 * transient errors делается retry с exponential backoff; на не-retryable errors
 * (auth/budget/422) — fail immediately без бесполезного retry.
 */

export interface ExternalCallOptions {
  /** Hard per-attempt timeout. Operation Promise гонится против timeout — если не завершится, throw. */
  timeoutMs?: number
  /** Максимум попыток (включая первую). 1 = без retry. */
  maxRetries?: number
  /** Базовая задержка перед первым retry в мс. */
  initialBackoffMs?: number
  /** Multiplier для exponential backoff (delay_n = initial * multiplier^(n-1)). */
  backoffMultiplier?: number
  /** Максимальная задержка между retries (capped). */
  maxBackoffMs?: number

  /** Callback на каждую попытку (для логирования). */
  onAttempt?: (attempt: number) => void
  /** Callback при failure до finальной попытки. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void

  /** Human-readable label для error messages и logs. */
  label: string
}

const DEFAULTS = {
  timeoutMs: 5 * 60 * 1000, // 5 минут per attempt
  maxRetries: 3,
  initialBackoffMs: 2000,
  backoffMultiplier: 2,
  maxBackoffMs: 30_000,
} as const

/**
 * Wrap async operation with hard timeout + retry.
 *
 * Гарантии:
 *   - Каждая попытка завершится максимум за `timeoutMs` мс (через Promise.race).
 *   - На transient errors → retry с exponential backoff до `maxRetries` попыток.
 *   - На non-retryable errors (auth/budget/422) → fail immediately.
 *   - При исчерпании retries → throw aggregated error с label.
 *
 * Limitations:
 *   - Promise.race не отменяет underlying operation — если у тебя fetch без
 *     AbortController, он продолжит висеть в фоне после timeout (но caller уже
 *     получил error). Для критичных мест лучше пробрасывать AbortSignal в
 *     operation и реагировать на него. Сейчас helper достаточен чтобы pipeline
 *     не висел — фоновый dangling fetch съест socket, но не таймаут шага.
 */
export async function withTimeoutAndRetry<T>(
  operation: (attempt: number) => Promise<T>,
  opts: ExternalCallOptions,
): Promise<T> {
  const config = {
    timeoutMs: opts.timeoutMs ?? DEFAULTS.timeoutMs,
    maxRetries: opts.maxRetries ?? DEFAULTS.maxRetries,
    initialBackoffMs: opts.initialBackoffMs ?? DEFAULTS.initialBackoffMs,
    backoffMultiplier: opts.backoffMultiplier ?? DEFAULTS.backoffMultiplier,
    maxBackoffMs: opts.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
  }

  if (config.maxRetries < 1) {
    throw new Error(`withTimeoutAndRetry: maxRetries must be >= 1 (got ${config.maxRetries})`)
  }

  let lastError: unknown

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    opts.onAttempt?.(attempt)

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        operation(attempt),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(
              `${opts.label} timeout after ${config.timeoutMs}ms (attempt ${attempt}/${config.maxRetries})`,
            ))
          }, config.timeoutMs)
        }),
      ])
      return result
    } catch (err) {
      lastError = err

      // Не retry-able errors — fail immediately без задержек
      if (isNonRetryableError(err)) {
        throw err
      }

      // Последняя попытка — кидаем aggregated error
      if (attempt === config.maxRetries) {
        const cause = err instanceof Error ? err.message : String(err)
        throw new Error(
          `${opts.label} failed after ${config.maxRetries} attempt(s): ${cause}`,
          { cause: err instanceof Error ? err : undefined },
        )
      }

      const delayMs = Math.min(
        config.initialBackoffMs * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxBackoffMs,
      )
      opts.onRetry?.(attempt, err, delayMs)

      await sleep(delayMs)
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }

  // Unreachable — loop либо return, либо throw. Но TS не верит.
  throw lastError ?? new Error(`${opts.label}: unexpected end of retry loop`)
}

/**
 * Классифицирует error как non-retryable.
 *
 * Семантика:
 *   - 401/403 — auth issue, retry бесполезен
 *   - 422 — validation issue, retry бесполезен (provider говорит "вы что-то не так послали")
 *   - "exhausted balance" / "insufficient credit" — нужно пополнить аккаунт, не retry
 *   - "invalid api key" / "unauthorized" — заменить ключ
 *
 * Network errors (ECONNRESET, ETIMEDOUT, socket hang up) и 5xx — retry-able.
 */
export function isNonRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false

  // Структурированные HTTP-ошибки (ofetch / fetch wrapper)
  const e = err as Record<string, unknown>
  const response = e.response as Record<string, unknown> | undefined
  const status = (response?.status as number | undefined)
    ?? (e.statusCode as number | undefined)
    ?? (e.status as number | undefined)

  if (status === 401 || status === 403 || status === 422) {
    return true
  }

  // Текстовая классификация по message
  const message = err instanceof Error ? err.message.toLowerCase() : ""
  if (!message) return false

  // Auth / API key issues
  if (message.includes("invalid api key")) return true
  if (message.includes("api-ключ") && message.includes("невалид")) return true
  if (message.includes("api-ключ") && message.includes("не настроен")) return true

  // Budget issues
  if (message.includes("exhausted balance")) return true
  if (message.includes("insufficient credit")) return true
  if (message.includes("баланс fal.ai исчерпан")) return true

  // Access issues
  if (message.includes("not authorized for this model")) return true

  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
