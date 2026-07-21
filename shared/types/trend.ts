export interface ZavodTrendPayload {
  id: number
  platform: string
  sourceUrl: string
  title: string
  description?: string
  authorName?: string
  thumbnailUrl?: string
  videoUrl?: string
  viewCount?: number
  likeCount?: number
  commentCount?: number
  publishedAt?: string
  hashtags?: string[]
  appId?: number
  appName?: string
  insights?: Array<{
    whyViral: string
    patterns?: string[]
    hooks?: string[]
    audience?: string
    confidence?: number
  }>
}

export interface TrendListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface TrendStatsResponse {
  total: number
  byStatus: Record<string, number>
  byPlatform: Record<string, number>
  recentCount: number
}

export interface IntegrationStatusResponse {
  connected: boolean
  lastChecked: string
  error?: string
}
