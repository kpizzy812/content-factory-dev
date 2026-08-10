export interface ReplicateErrorClassification {
  status: number | null
  retryable: boolean
  message: string
  /** Сколько секунд просит подождать сам Replicate (429). */
  retryAfterSec: number | null
}

export class ReplicateProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status: number | null,
    cause?: unknown,
    /** Пауза, назначенная провайдером; важнее нашего собственного бэкоффа. */
    public readonly retryAfterSec: number | null = null,
  ) {
    super(message, { cause: cause instanceof Error ? cause : undefined })
    this.name = "ReplicateProviderError"
  }
}

export function classifyReplicateError(error: unknown): ReplicateErrorClassification {
  const status = extractStatus(error)
  const message = error instanceof Error ? error.message : String(error)

  return {
    status,
    retryable: status === null
      || status === 408
      || status === 409
      || status === 429
      || status >= 500,
    message,
    retryAfterSec: extractRetryAfter(error, message),
  }
}

/**
 * Replicate отвечает на 429 полем `retry_after` в теле и заголовком Retry-After.
 * Клиент отдаёт нам ошибку уже строкой, поэтому читаем и то, и другое: своя
 * фиксированная пауза короче назначенной и приводит ко второму такому же отказу.
 */
function extractRetryAfter(error: unknown, message: string): number | null {
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>
    const direct = value.retry_after ?? value.retryAfter
    const parsedDirect = toPositiveSeconds(direct)
    if (parsedDirect !== null) return parsedDirect

    const headers = (value.response as { headers?: unknown } | undefined)?.headers
    if (headers && typeof (headers as { get?: unknown }).get === "function") {
      const header = (headers as { get(name: string): string | null }).get("retry-after")
      const parsedHeader = toPositiveSeconds(header)
      if (parsedHeader !== null) return parsedHeader
    }
  }

  const match = message.match(/"retry_after"\s*:\s*(\d+(?:\.\d+)?)/)
  return match ? toPositiveSeconds(match[1]) : null
}

function toPositiveSeconds(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(parsed, 300)
}

export function sanitizeReplicateErrorMessage(message: string, apiToken: string | null): string {
  if (!apiToken) return message
  return message.split(apiToken).join("[REDACTED]")
}

export function toReplicateProviderError(
  error: unknown,
  apiToken: string | null,
): ReplicateProviderError {
  if (error instanceof ReplicateProviderError) return error
  const classified = classifyReplicateError(error)
  return new ReplicateProviderError(
    sanitizeReplicateErrorMessage(classified.message, apiToken),
    classified.retryable,
    classified.status,
    error,
    classified.retryAfterSec,
  )
}

function extractStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null
  const value = error as Record<string, unknown>
  const response = value.response as Record<string, unknown> | undefined
  const status = value.status ?? value.statusCode ?? response?.status
  return typeof status === "number" ? status : null
}
