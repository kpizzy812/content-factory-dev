export const DEFAULT_INSTAGRAM_API_VERSION = "v25.0"

export type InstagramContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED"
export type InstagramTrialStrategy = "MANUAL" | "SS_PERFORMANCE"

export interface InstagramPublishingLimit {
  quotaUsage: number | null
  quotaTotal: number | null
}

export interface InstagramMedia {
  id: string
  permalink: string | null
  likeCount: number
  commentsCount: number
}

export interface InstagramMediaInsights {
  views?: number
  plays?: number
  likes?: number
  comments?: number
  shares?: number
  averageWatchTimeMs?: number
}

export interface InstagramApiClient {
  getPublishingLimit(userId: string): Promise<InstagramPublishingLimit>
  createReelContainer(input: {
    userId: string
    videoUrl: string
    caption: string
    shareToFeed: boolean
    trialStrategy?: InstagramTrialStrategy
  }): Promise<string>
  getContainerStatus(containerId: string): Promise<{
    statusCode: InstagramContainerStatus
    status: string | null
  }>
  publishContainer(userId: string, containerId: string): Promise<string>
  getMedia(mediaId: string): Promise<InstagramMedia>
  getMediaInsights(mediaId: string): Promise<InstagramMediaInsights>
}

export type InstagramFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

interface CreateInstagramApiClientOptions {
  accessToken: string
  apiVersion?: string
  fetchImpl?: InstagramFetch
  graphBaseUrl?: string
}

interface MetaErrorPayload {
  message?: string
  type?: string
  code?: number
  error_subcode?: number
  is_transient?: boolean
  fbtrace_id?: string
}

export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly retryable = false,
  ) {
    super(message)
    this.name = "InstagramApiError"
  }
}

function validateVersion(value: string): string {
  if (!/^v\d+\.\d+$/.test(value)) {
    throw new Error(`Invalid Instagram Graph API version: ${value}`)
  }
  return value
}

function numberOrNull(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function metricValue(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined
  const metric = value as Record<string, unknown>
  if (Number.isFinite(Number(metric.value))) return Number(metric.value)
  if (!Array.isArray(metric.values) || metric.values.length === 0) return undefined
  const last = metric.values[metric.values.length - 1]
  if (!last || typeof last !== "object") return undefined
  const numeric = Number((last as Record<string, unknown>).value)
  return Number.isFinite(numeric) ? numeric : undefined
}

export function createInstagramApiClient({
  accessToken,
  apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || DEFAULT_INSTAGRAM_API_VERSION,
  fetchImpl = fetch,
  graphBaseUrl = "https://graph.instagram.com",
}: CreateInstagramApiClientOptions): InstagramApiClient {
  if (!accessToken) throw new Error("Instagram access token is required")
  const version = validateVersion(apiVersion)
  const base = graphBaseUrl.replace(/\/+$/, "")

  async function request<T>(
    path: string,
    options: { method?: "GET" | "POST"; params?: Record<string, string> } = {},
  ): Promise<T> {
    if (!path || path.includes("..")) throw new Error("Invalid Instagram API path")
    const method = options.method ?? "GET"
    const url = new URL(`${base}/${version}/${path.replace(/^\/+/, "")}`)
    const params = new URLSearchParams(options.params)
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
    if (method === "GET") {
      for (const [key, value] of params) url.searchParams.set(key, value)
    } else {
      init.headers = {
        ...init.headers,
        "Content-Type": "application/x-www-form-urlencoded",
      }
      init.body = params.toString()
    }

    let response: Response
    try {
      response = await fetchImpl(url, init)
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error"
      throw new InstagramApiError(`Instagram API network error: ${message}`, 0, undefined, undefined, true)
    }

    const text = await response.text()
    let payload: Record<string, unknown> = {}
    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>
      } catch {
        if (!response.ok) {
          throw new InstagramApiError(`Instagram API HTTP ${response.status}`, response.status)
        }
        throw new InstagramApiError("Instagram API returned invalid JSON", response.status)
      }
    }
    const metaError = payload.error as MetaErrorPayload | undefined
    if (!response.ok || metaError) {
      const message = metaError?.message || `Instagram API HTTP ${response.status}`
      throw new InstagramApiError(
        `Instagram API: ${message}`,
        response.status,
        metaError?.code,
        metaError?.error_subcode,
        Boolean(metaError?.is_transient || response.status === 429 || response.status >= 500),
      )
    }
    return payload as T
  }

  return {
    async getPublishingLimit(userId) {
      const response = await request<{
        data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>
      }>(`${encodeURIComponent(userId)}/content_publishing_limit`, {
        params: { fields: "quota_usage,config" },
      })
      const item = response.data?.[0]
      return {
        quotaUsage: numberOrNull(item?.quota_usage),
        quotaTotal: numberOrNull(item?.config?.quota_total),
      }
    },

    async createReelContainer(input) {
      const params: Record<string, string> = {
        media_type: "REELS",
        video_url: input.videoUrl,
        caption: input.caption,
        share_to_feed: String(input.shareToFeed),
      }
      if (input.trialStrategy) {
        params.trial_params = JSON.stringify({
          graduation_strategy: input.trialStrategy,
        })
      }
      const response = await request<{ id?: string }>(
        `${encodeURIComponent(input.userId)}/media`,
        { method: "POST", params },
      )
      if (!response.id) throw new Error("Instagram did not return a media container id")
      return response.id
    },

    async getContainerStatus(containerId) {
      const response = await request<{ status_code?: string; status?: string }>(
        encodeURIComponent(containerId),
        { params: { fields: "status_code,status" } },
      )
      const statusCode = response.status_code as InstagramContainerStatus
      if (!["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED"].includes(statusCode)) {
        throw new Error(`Instagram returned an unknown container status: ${response.status_code}`)
      }
      return { statusCode, status: response.status ?? null }
    },

    async publishContainer(userId, containerId) {
      const response = await request<{ id?: string }>(
        `${encodeURIComponent(userId)}/media_publish`,
        { method: "POST", params: { creation_id: containerId } },
      )
      if (!response.id) throw new Error("Instagram did not return a published media id")
      return response.id
    },

    async getMedia(mediaId) {
      const response = await request<{
        id?: string
        permalink?: string
        like_count?: number
        comments_count?: number
      }>(encodeURIComponent(mediaId), {
        params: { fields: "id,permalink,like_count,comments_count" },
      })
      return {
        id: response.id ?? mediaId,
        permalink: response.permalink ?? null,
        likeCount: numberOrNull(response.like_count) ?? 0,
        commentsCount: numberOrNull(response.comments_count) ?? 0,
      }
    },

    async getMediaInsights(mediaId) {
      const response = await request<{ data?: Array<Record<string, unknown>> }>(
        `${encodeURIComponent(mediaId)}/insights`,
        {
          params: {
            metric: "views,plays,likes,comments,shares,ig_reels_avg_watch_time",
          },
        },
      )
      const metrics = new Map(
        (response.data ?? [])
          .filter(item => typeof item.name === "string")
          .map(item => [String(item.name), metricValue(item)]),
      )
      return {
        views: metrics.get("views"),
        plays: metrics.get("plays"),
        likes: metrics.get("likes"),
        comments: metrics.get("comments"),
        shares: metrics.get("shares"),
        averageWatchTimeMs: metrics.get("ig_reels_avg_watch_time"),
      }
    },
  }
}

export async function refreshInstagramLongLivedToken(
  accessToken: string,
  fetchImpl: InstagramFetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL("https://graph.instagram.com/refresh_access_token")
  url.searchParams.set("grant_type", "ig_refresh_token")
  url.searchParams.set("access_token", accessToken)
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } })
  const payload = await response.json() as {
    access_token?: string
    expires_in?: number
    error?: MetaErrorPayload
  }
  if (!response.ok || payload.error || !payload.access_token) {
    throw new InstagramApiError(
      `Instagram token refresh failed: ${payload.error?.message || response.status}`,
      response.status,
      payload.error?.code,
      payload.error?.error_subcode,
    )
  }
  return {
    accessToken: payload.access_token,
    expiresIn: Number(payload.expires_in) || 5_184_000,
  }
}
