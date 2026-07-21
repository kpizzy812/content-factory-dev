export interface SocialAccountStyleSummary {
  id: number
  status: 'not_set' | 'partial' | 'complete'
  version: number
}

export interface SocialAccount {
  id: number
  appId: number
  platform: "youtube" | "tiktok" | "instagram"
  displayName: string
  platformUserId: string | null
  status: "active" | "expired" | "revoked"
  expiresAt: string | null
  createdAt: string
  updatedAt: string
  _count?: {
    uploads: number
    groups: number
  }
  styleProfile?: SocialAccountStyleSummary | null
}

export interface AccountGroupMember {
  id: number
  groupId: number
  socialAccountId: number
  socialAccount: Pick<SocialAccount, "id" | "platform" | "displayName" | "status">
}

export interface AccountGroup {
  id: number
  appId: number
  name: string
  styleMode: 'independent' | 'unified' | 'base_with_overrides'
  createdAt: string
  members: AccountGroupMember[]
}

export type UploadStatus =
  | "pending"
  | "uploading"
  | "published"
  | "failed"
  | "scheduled"
  | "canceled"
  | "blocked_by_env"

export interface SocialUploadAttempt {
  id: number
  uploadId: number
  attemptNumber: number
  status: string
  requestSnapshot: unknown
  responseSnapshot: unknown
  externalUploadId: string | null
  externalPostId: string | null
  startedAt: string
  finishedAt: string | null
  errorMessage: string | null
  createdAt: string
}

/**
 * Расширение SocialAccount для встроенного DTO в Upload-листинге.
 * 1:1:1 anti-detect поля + login-check (для browser_automation).
 * Все поля optional — backwards compat с местами, где endpoint
 * не отдаёт расширенный shape (детальный get Upload и т.д.).
 */
export interface UploadSocialAccountDto
  extends Pick<SocialAccount, "id" | "platform" | "displayName" | "status"> {
  postingMethod?: "api" | "browser_automation"
  proxyId?: string | null
  deviceProfileId?: string | null
  loginCheckedAt?: string | null
  loginCheckedStatus?: boolean | null
  loginCheckedUsername?: string | null
  proxy?: {
    id: string
    label: string
    status: "unverified" | "healthy" | "degraded" | "dead" | "expired"
  } | null
}

/**
 * Сокращённый snapshot связанного PostingJob (1:1 opt-in через Upload.uploadId).
 * Используется на UploadCard для chip'а «через PostingJob #xxx».
 */
export interface UploadPostingJobLink {
  id: string
  status:
    | "scheduled"
    | "queued"
    | "preparing"
    | "uploading"
    | "published"
    | "failed"
    | "retry_queued"
    | "cancelled"
  errorCategory: string | null
}

export interface Upload {
  id: number
  videoId: number
  socialAccountId: number
  applicationId: number | null
  status: UploadStatus
  publishMode: string
  scheduledAt: string | null
  platformPostId: string | null
  platformPostUrl: string | null
  title: string
  description: string | null
  hashtags: string[]
  idempotencyKey: string
  errorMessage: string | null
  blockedByEnv: boolean
  attemptCount: number
  lastAttemptAt: string | null
  createdAt: string
  updatedAt: string
  socialAccount?: UploadSocialAccountDto
  video?: {
    id: number
    status: string
    fileUrl: string | null
    format?: string
    duration?: number
  }
  postingJob?: UploadPostingJobLink | null
  attempts?: SocialUploadAttempt[]
}

export interface UploadListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface PlatformCapability {
  available: boolean
  directPublish: boolean
  draftMode: boolean
  schedulingSupport: string
  asyncProcessing: boolean
  statusPolling: boolean
  resumableUpload: boolean
  maxFileSize: string
  metadataFields: string[]
  limitations: string[]
  oauthConfigured: boolean
}

export interface UploadModuleStatus {
  enabled: boolean
  envFlag: string
  platforms: Record<string, PlatformCapability>
  statusCounts: Record<string, number>
}
