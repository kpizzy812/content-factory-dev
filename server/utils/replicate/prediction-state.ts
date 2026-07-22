import type { MediaPredictionStatus } from "../media-provider/types"

const TERMINAL_STATUSES = new Set<MediaPredictionStatus>([
  "succeeded",
  "failed",
  "canceled",
])

const ALLOWED_TRANSITIONS: Record<MediaPredictionStatus, ReadonlySet<MediaPredictionStatus>> = {
  starting: new Set(["processing", "succeeded", "failed", "canceled"]),
  processing: new Set(["succeeded", "failed", "canceled"]),
  succeeded: new Set(),
  failed: new Set(),
  canceled: new Set(),
}

export interface PredictionTransition {
  status: MediaPredictionStatus
  changed: boolean
  terminal: boolean
}

export function isTerminalPredictionStatus(status: MediaPredictionStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function transitionPredictionStatus(
  current: MediaPredictionStatus,
  next: MediaPredictionStatus,
): PredictionTransition {
  if (current === next) {
    return {
      status: current,
      changed: false,
      terminal: isTerminalPredictionStatus(current),
    }
  }

  if (isTerminalPredictionStatus(current)) {
    throw new Error(`Cannot move terminal prediction from ${current} to ${next}`)
  }

  if (!ALLOWED_TRANSITIONS[current].has(next)) {
    throw new Error(`Invalid prediction transition from ${current} to ${next}`)
  }

  return {
    status: next,
    changed: true,
    terminal: isTerminalPredictionStatus(next),
  }
}

export function sanitizePredictionSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizePredictionSnapshot)
  }

  if (!value || typeof value !== "object") {
    return value
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = isSensitiveKey(key)
      ? "[REDACTED]"
      : sanitizePredictionSnapshot(nestedValue)
  }
  return sanitized
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase()
  return normalized === "authorization"
    || normalized === "apikey"
    || normalized.endsWith("token")
    || normalized.endsWith("secret")
    || normalized.endsWith("password")
}
