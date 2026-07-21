import type { ZavodTrendPayload } from "../../shared/types/trend"

const VALID_PLATFORMS = ["tiktok", "instagram", "youtube"] as const
type ValidPlatform = typeof VALID_PLATFORMS[number]

/**
 * Validates that payload has all required fields for a trend.
 * Returns an error string if invalid, null if valid.
 */
export function validateTrendPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return "Payload must be an object"
  }

  const p = payload as Record<string, unknown>

  if (typeof p.id !== "number") {
    return "Field 'id' is required and must be a number"
  }

  if (typeof p.platform !== "string" || !VALID_PLATFORMS.includes(p.platform as ValidPlatform)) {
    return `Field 'platform' must be one of: ${VALID_PLATFORMS.join(", ")}`
  }

  // sourceUrl и title могут быть null в MarketingCamp — подставляем fallback
  if (p.sourceUrl == null) {
    (p as any).sourceUrl = ""
  }
  if (p.title == null || (typeof p.title === "string" && p.title.length === 0)) {
    (p as any).title = `Тренд #${p.id}`
  }

  return null
}

/**
 * Maps platform string to Prisma Platform enum value.
 */
function mapPlatform(platform: string): ValidPlatform {
  const lower = platform.toLowerCase() as ValidPlatform
  if (!VALID_PLATFORMS.includes(lower)) {
    throw new Error(`Invalid platform: ${platform}`)
  }
  return lower
}

/**
 * Maps ZavodTrendPayload to data suitable for Prisma trend upsert.
 */
export function mapPayloadToTrend(payload: ZavodTrendPayload) {
  return {
    externalId: payload.id,
    platform: mapPlatform(payload.platform),
    sourceUrl: payload.sourceUrl || "",
    title: payload.title || `Тренд #${payload.id}`,
    description: payload.description ?? null,
    authorName: payload.authorName ?? null,
    thumbnailUrl: payload.thumbnailUrl ?? null,
    videoUrl: payload.videoUrl ?? null,
    viewCount: payload.viewCount ?? 0,
    likeCount: payload.likeCount ?? 0,
    commentCount: payload.commentCount ?? 0,
    hashtags: payload.hashtags ?? [],
    publishedAt: payload.publishedAt ? new Date(payload.publishedAt) : null,
  }
}

/**
 * Maps insight data from payload to Prisma TrendInsight create format.
 */
export function mapPayloadInsight(insight: NonNullable<ZavodTrendPayload["insights"]>[number]) {
  return {
    whyViral: insight.whyViral,
    patterns: insight.patterns ?? [],
    hooks: insight.hooks ?? [],
    audience: insight.audience ?? null,
    confidence: insight.confidence ?? null,
  }
}
