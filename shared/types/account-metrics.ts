/**
 * Типы Account Metrics (Часть C).
 *
 * Snapshot — снимок метрик профиля соцсети через Apify profile-scrapers.
 *
 * Внимание к BigInt: счётчики followers/views на больших каналах
 * могут превышать Number.MAX_SAFE_INTEGER крайне редко, но БД хранит их
 * как BIGINT. JSON.stringify не умеет BigInt, поэтому DTO для UI содержит
 * `string | null` для BigInt-полей.
 *
 * shared/types/ изолирован от app/generated/prisma — используем локальный
 * MetricsPlatform вместо Prisma enum, чтобы не тянуть генерированный
 * клиент через цепочку импортов в bundle.
 */

/**
 * Платформа для profile-режима Apify. Часть C поддерживает только эти три.
 */
export type MetricsPlatform = "tiktok" | "instagram" | "youtube"

/**
 * Нормализованный пост из выборки последних N постов аккаунта.
 * Используется и для расчёта engagement/avgViewsPer30d, и для UI-списка.
 */
export interface NormalizedPost {
  /** ID/URL-хэш поста, уникальный в рамках платформы */
  id: string
  url: string
  thumbnailUrl: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  /** Только TikTok */
  shareCount?: number
  /** ISO 8601 строка или null если scraper не вернул дату */
  publishedAt: string | null
  /** Первые 200 символов caption/title */
  title: string | null
}

/**
 * Результат mapper'а — то, что возвращается из mapApifyToAccountMetrics.
 * Используется внутри server-сайда, до сериализации в DTO.
 */
export interface AccountMetricsResult {
  followers: bigint | null
  following: bigint | null
  totalViews: bigint | null
  totalLikes: bigint | null
  totalComments: bigint | null
  postsCount: number | null
  avgViewsPer30d: bigint | null
  /** 0..1 (clamped) */
  engagementRate: number | null
  bio: string | null
  avatarUrl: string | null
  isVerified: boolean | null
  sampleSize: number
  posts: NormalizedPost[]
  status: "ok" | "error"
  errorMessage?: string
  /** Первый item для диагностики (при ошибке mapping'а) */
  rawSample?: unknown
}

/**
 * DTO снимка для GET /api/accounts/:id/metrics.
 * BigInt-поля сериализованы в string, чтобы JSON.stringify не падал.
 */
export interface AccountMetricsSnapshotDTO {
  id: string
  /** ISO timestamp */
  fetchedAt: string
  followers: string | null
  following: string | null
  totalViews: string | null
  totalLikes: string | null
  totalComments: string | null
  postsCount: number | null
  avgViewsPer30d: string | null
  engagementRate: number | null
  bio: string | null
  avatarUrl: string | null
  isVerified: boolean | null
  status: "ok" | "error"
  errorMessage: string | null
  /** Возвращается только если запрошено `?includeRaw=1` */
  rawData?: { sampleSize: number; posts: NormalizedPost[] } | null
}

/**
 * Ответ GET /api/accounts/:id/metrics.
 */
export interface AccountMetricsResponse {
  data: {
    snapshots: AccountMetricsSnapshotDTO[]
    total: number
    platform: MetricsPlatform
    platformHandle: string | null
  }
}

/**
 * Ответ POST /api/accounts/:id/metrics/fetch.
 * При `skipped: true` (24h cache hit) snapshot — последний 'ok' снимок.
 */
export interface AccountMetricsFetchResponse {
  data: {
    skipped: boolean
    snapshot: AccountMetricsSnapshotDTO
    reason?: "already_fetched_today"
  }
}
