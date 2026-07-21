import type { AccountMetricsSnapshotDTO } from "./account-metrics"

/**
 * Метрики одного поста (снимок на момент сбора).
 */
export interface PostMetrics {
  id: number
  uploadId: number
  views: number
  likes: number
  comments: number
  shares: number
  watchThrough: number
  ctr: number
  followerGain: number
  collectedAt: string
}

/**
 * Референс — успешный ролик, попавший в базу референсов.
 */
export interface Reference {
  id: number
  uploadId: number
  reason: string
  aiAnalysis: string | null
  addedAt: string
  upload?: UploadWithMetrics
}

/**
 * Загрузка с последними метриками для таблицы аналитики.
 */
export interface UploadWithMetrics {
  id: number
  videoId: number
  socialAccountId: number
  status: "pending" | "uploading" | "published" | "failed" | "scheduled"
  postStatus: "active" | "deleted" | "blocked"
  platformPostId: string | null
  platformPostUrl: string | null
  title: string
  description: string | null
  hashtags: string[]
  createdAt: string
  updatedAt: string
  socialAccount?: {
    id: number
    platform: "youtube" | "tiktok" | "instagram"
    displayName: string
  }
  video?: {
    id: number
    fileUrl: string | null
    duration: number | null
  }
  latestMetrics: PostMetrics | null
}

/**
 * Данные сводного дашборда аналитики.
 */
export interface DashboardData {
  totalViews: number
  totalFollowerGain: number
  avgWatchThrough: number
  bestPost: UploadWithMetrics | null
  topCtrPosts: UploadWithMetrics[]
}

/**
 * Фильтры для запросов аналитики.
 */
export interface AnalyticsFilters {
  platform?: "youtube" | "tiktok" | "instagram"
  socialAccountId?: number
  postStatus?: "active" | "deleted" | "blocked"
  dateFrom?: string
  dateTo?: string
  sortBy?: "views" | "likes" | "comments" | "shares" | "watchThrough" | "ctr" | "followerGain" | "createdAt"
  sortOrder?: "asc" | "desc"
  page?: number
  perPage?: number
}

/**
 * Мета-информация для списка аналитики с пагинацией.
 */
export interface AnalyticsListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

/**
 * Один аккаунт в сводке /api/analytics/accounts-summary.
 * Apify-метрики через AccountMetricsSnapshot, покрывает любой postingMethod
 * (api OAuth / browser_automation), т.к. скрейпят публичный профиль.
 */
export interface AccountsSummaryItem {
  account: {
    id: number
    displayName: string
    platform: "tiktok" | "instagram" | "youtube"
    platformHandle: string | null
    status: "active" | "expired" | "revoked"
    app: { id: number; name: string } | null
  }
  /** Последний 'ok'-снимок для StatCards (null если ни одного успешного сбора). */
  latestOkSnapshot: AccountMetricsSnapshotDTO | null
  /** До 14 последних снимков DESC (для AccountMetricsSparkline и индикации серии). */
  recentSnapshots: AccountMetricsSnapshotDTO[]
  /** ISO timestamp последнего любого снимка (для бейджа «обновлено N часов назад»). */
  lastFetchedAt: string | null
  /** Всего снимков для аккаунта (history depth). */
  snapshotsCount: number
}

/**
 * Aggregate-блок для верхней панели на табе «Аккаунты».
 * totalFollowers — string из BigInt (см. serializeSnapshot).
 */
export interface AccountsSummaryAggregate {
  accountsTotal: number
  accountsWithMetrics: number
  totalFollowers: string
  avgEngagement: number | null
}

export interface AccountsSummaryResponse {
  data: {
    items: AccountsSummaryItem[]
    aggregate: AccountsSummaryAggregate
  }
}

export interface AccountsSummaryFilters {
  appId?: number
  platform?: "tiktok" | "instagram" | "youtube"
}
