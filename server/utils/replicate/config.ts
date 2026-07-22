export const DEFAULT_REPLICATE_LIPSYNC_MODEL = "kwaivgi/kling-lip-sync"
export const REPLICATE_WEBHOOK_PATH = "/api/webhooks/replicate"

type Env = Record<string, string | undefined>

export interface ReplicateConfig {
  apiToken: string | null
  webhookSigningSecret: string | null
  webhookBaseUrl: string | null
  webhookUrl: string | null
  defaultLipSyncModel: string
  mockMode: boolean
  recoveryEnabled: boolean
  fallbackProvider: "fal" | null
}

export function readReplicateConfig(env: Env = process.env): ReplicateConfig {
  const mockMode = env.REPLICATE_MOCK_MODE === "true"
  const apiToken = valueOrNull(env.REPLICATE_API_TOKEN)
  const signingSecret = valueOrNull(env.REPLICATE_WEBHOOK_SIGNING_SECRET)
  const rawBaseUrl = valueOrNull(env.REPLICATE_WEBHOOK_BASE_URL)

  if (!mockMode && !apiToken) {
    throw new Error("REPLICATE_API_TOKEN is required when REPLICATE_MOCK_MODE is not true")
  }

  if (!mockMode && !rawBaseUrl) {
    throw new Error("REPLICATE_WEBHOOK_BASE_URL is required when Replicate webhooks are enabled")
  }

  if (!mockMode && !signingSecret) {
    throw new Error("REPLICATE_WEBHOOK_SIGNING_SECRET is required when Replicate webhooks are enabled")
  }

  const webhookBaseUrl = rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : null
  const fallbackProvider = parseFallbackProvider(env.MEDIA_PROVIDER_FALLBACK)

  return {
    apiToken,
    webhookSigningSecret: signingSecret,
    webhookBaseUrl,
    webhookUrl: webhookBaseUrl ? `${webhookBaseUrl}${REPLICATE_WEBHOOK_PATH}` : null,
    defaultLipSyncModel: valueOrNull(env.REPLICATE_DEFAULT_LIPSYNC_MODEL)
      ?? DEFAULT_REPLICATE_LIPSYNC_MODEL,
    mockMode,
    recoveryEnabled: env.REPLICATE_RECOVERY_ENABLED !== "false",
    fallbackProvider,
  }
}

function valueOrNull(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("REPLICATE_WEBHOOK_BASE_URL must be a valid absolute URL")
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("REPLICATE_WEBHOOK_BASE_URL must use http or https")
  }

  return parsed.toString().replace(/\/$/, "")
}

function parseFallbackProvider(value: string | undefined): "fal" | null {
  const normalized = valueOrNull(value)
  if (!normalized) return null
  if (normalized === "fal") return normalized
  throw new Error("MEDIA_PROVIDER_FALLBACK must be empty or 'fal'")
}
