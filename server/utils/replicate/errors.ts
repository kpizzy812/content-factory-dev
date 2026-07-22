export interface ReplicateErrorClassification {
  status: number | null
  retryable: boolean
  message: string
}

export class ReplicateProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status: number | null,
    cause?: unknown,
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
  }
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
  )
}

function extractStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null
  const value = error as Record<string, unknown>
  const response = value.response as Record<string, unknown> | undefined
  const status = value.status ?? value.statusCode ?? response?.status
  return typeof status === "number" ? status : null
}
