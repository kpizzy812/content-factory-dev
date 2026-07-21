/**
 * Shared-типы для PostingJob state machine (Social Automation, итерация 4 — Track D).
 * Используются и сервером, и клиентом (composables, components, stores).
 *
 * Зеркалит prisma enum'ы PostingJobStatus / PostingErrorCategory / Platform.
 * Дублируем здесь, чтобы не тащить generated client в app/.
 */

export type PostingJobStatus =
  | "scheduled"
  | "queued"
  | "preparing"
  | "uploading"
  | "published"
  | "failed"
  | "retry_queued"
  | "cancelled"

export const POSTING_JOB_STATUSES: readonly PostingJobStatus[] = [
  "scheduled",
  "queued",
  "preparing",
  "uploading",
  "published",
  "failed",
  "retry_queued",
  "cancelled",
] as const

/**
 * Non-terminal статусы — для них имеет смысл polling и операции отмены.
 * published / cancelled — terminal (job больше не движется автоматом).
 * failed — условно-terminal: оператор может перевести в retry_queued.
 */
export const POSTING_JOB_ACTIVE_STATUSES: readonly PostingJobStatus[] = [
  "scheduled",
  "queued",
  "preparing",
  "uploading",
  "retry_queued",
] as const

export type PostingErrorCategory =
  | "auth_failed"
  | "proxy_dead"
  | "network_error"
  | "platform_5xx"
  | "platform_validation"
  | "platform_rate_limit"
  | "content_rejected"
  | "account_locked"
  | "internal_error"
  | "unknown"
  // Part D — browser_automation specific (см. enum в prisma/schema.prisma и worker.ts)
  | "login_required"
  | "browser_connect_failed"
  | "selector_not_found"
  | "upload_failed"

export type SocialPostingMethod = "api" | "browser_automation"

export type ProxyStatusValue =
  | "unverified"
  | "healthy"
  | "degraded"
  | "dead"
  | "expired"

export interface PostingJobProxySummary {
  id: string
  label: string
  status: ProxyStatusValue
}

export type PostingPlatform = "tiktok" | "instagram" | "youtube"

export const POSTING_PLATFORMS: readonly PostingPlatform[] = [
  "tiktok",
  "instagram",
  "youtube",
] as const

/**
 * Минимальный DuoPlus device-контекст джобы — оператор видит, через какое
 * устройство идёт постинг и его last-known статус. Источник:
 * socialAccount → deviceProfile → { name, indigoId (=image_id),
 * config.duoplus.deviceStatus }. null если аккаунт не привязан к устройству
 * (api-постинг) или профиль ещё ни разу не синкался.
 */
export interface PostingJobDeviceSummary {
  /** DeviceProfile.id. */
  deviceProfileId: string
  /** Человекочитаемое имя устройства (DeviceProfile.name). */
  deviceName: string
  /** Внешний image_id DuoPlus (DeviceProfile.indigoId). null для local_only. */
  deviceImageId: string | null
  /** Last-known DuoPlus deviceStatus (config.duoplus.deviceStatus): 0/1/2/3/4/10/11/12. */
  deviceStatus: number | null
}

export interface PostingJobSocialAccountSummary {
  id: number
  displayName: string
  platform: PostingPlatform
  status: string
  /** 1:1:1 anti-detect: метод постинга (api OAuth vs browser_automation через Indigo+CDP). */
  postingMethod?: SocialPostingMethod
  /** 1:1:1: id привязанного прокси. null — proxy gating (postинг заблокирован). */
  proxyId?: string | null
  /** 1:1:1: id привязанного device-профиля. Обязателен для browser_automation. */
  deviceProfileId?: string | null
  /** Полная сводка по прокси для UI-бейджа и gating-индикатора. */
  proxy?: PostingJobProxySummary | null
  /** DuoPlus device-контекст (устройство + last-known статус). null для api-постинга. */
  device?: PostingJobDeviceSummary | null
}

export interface PostingJobVideoSummary {
  id: number
  status: string
  fileUrl: string | null
  duration?: number | null
}

/**
 * DTO для списка / детали PostingJob (выдаёт API).
 * Соответствует select'ам из server/api/posting-jobs/index.get.ts и [id].get.ts.
 */
export interface PostingJobDto {
  id: string
  videoId: number
  socialAccountId: number
  uploadId: number | null
  runId: number | null
  pipelineId: number | null
  status: PostingJobStatus
  scheduledAt: string | null
  idempotencyKey: string
  contentSnapshot: Record<string, unknown>
  platform: PostingPlatform
  attemptCount: number
  maxAttempts: number
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  platformPostId: string | null
  platformPostUrl: string | null
  apiMadeWarning: boolean
  lastError: string | null
  errorCategory: PostingErrorCategory | null
  /** Part D: фаза browser_automation, на которой упала последняя попытка (e.g. "login_check", "file_upload"). */
  lastErrorPhase?: string | null
  /** Part D: storageKey скриншота с момента ошибки. UI получает signed URL через /api/posting/screenshot-url. */
  lastErrorScreenshotKey?: string | null
  retryAt: string | null
  createdById: number | null
  cancelledById: number | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
  updatedAt: string
  socialAccount?: PostingJobSocialAccountSummary | null
  video?: PostingJobVideoSummary | null
}

export interface PostingJobLogDto {
  id: string
  jobId: string
  level: "info" | "warn" | "error" | string
  message: string
  data: Record<string, unknown> | null
  createdAt: string
}

/**
 * Сводка одного rolling/deadline-окна retry-класса (для диагностической панели).
 * windowExpiresAt = windowStartAt + windowMs класса (null для не-оконных).
 */
export interface FsmDiagnosticsClassWindow {
  errorClass: string
  count: number
  windowStartAt: string | null
  windowExpiresAt: string | null
  alertedAt: string | null
  lastPhase: string | null
  lastErrorAt: string | null
}

/**
 * Безопасный FSM-summary, который отдаёт GET /api/posting-jobs/[id] в поле `fsm`
 * (PR5A diagnostics). Содержит ТОЛЬКО состояние FSM — без cookies/proxy/tokens.
 * null на стороне API, если job не управляется FSM (нет stateData.fsmVersion).
 * `operator` — человекочитаемый view из shared/utils/posting-operator-format.ts.
 */
export interface FsmDiagnosticsSummary {
  isFsmManaged: boolean
  fsmVersion: number
  buildMarker: string | null
  currentPhase: string | null
  lastCompletedPhase: string | null
  progress: string | null
  lastErrorClass: string | null
  lastErrorPhase: string | null
  finalReason: string | null
  draftVideoId: string | null
  draftVideoIdPresent: boolean
  duplicateRiskAcknowledged: boolean
  classWindows: FsmDiagnosticsClassWindow[]
  nextRetryAt: string | null
  operatorClass: string
  operatorAction: string | null
  operator: import("../utils/posting-operator-format").OperatorFailureView | null
}

/**
 * Состояние DuoPlus-движка автоматизации (гейт DUOPLUS_ENGINE_ENABLED). Читается
 * на сервере (process.env) и отдаётся в ответе списка джоб, чтобы оператор видел,
 * исполняется ли browser_automation-постинг через DuoPlus-движок прямо сейчас.
 */
export interface PostingEngineMeta {
  /** true — реальный AdbAutomationEngine; false — freeze (движок выключен). */
  duoplusEngineEnabled: boolean
}

export interface PostingJobListResponse {
  items: PostingJobDto[]
  total: number
  /** Состояние DuoPlus-движка (для инфо-плашки на странице постинга). */
  engine?: PostingEngineMeta
}

export interface PostingJobLogsResponse {
  items: PostingJobLogDto[]
  total: number
}

export interface PostingJobStats {
  byStatus: Record<PostingJobStatus, number>
  byPlatform: Record<PostingPlatform, number>
  topAccounts: Array<{
    socialAccountId: number
    count: number
    displayName: string
    platform: PostingPlatform | null
    status: string | null
  }>
}

export interface PostingJobsFiltersQuery {
  status?: string
  platform?: PostingPlatform
  socialAccountId?: number
  from?: string
  to?: string
  limit?: number
  offset?: number
}

// ---- Bulk-create types ----

export interface BulkCreatePair {
  socialAccountId: number
  videoId: number
  /** ISO datetime — клиент уже посчитал через generateBulkSchedule. */
  scheduledAt: string
  /**
   * Содержимое для contentSnapshot. Для YouTube ожидается structured shape
   * (см. server/utils/posting/youtube-snapshot-validator.ts) — title/description?/
   * hashtags?/youtube: {visibility, madeForKids}. caption/description общие
   * поля для TikTok/Instagram (Phase 2 — только YouTube).
   */
  contentSnapshot: Record<string, unknown>
}

export interface BulkCreateRequest {
  platform: PostingPlatform
  pairs: BulkCreatePair[]
  /** Окно для validateScheduledInWindow на сервере. */
  windowStart: string
  windowEnd: string
  /** Дефолт 4ч (MIN_INTERVAL_MS из bulk-scheduling.ts). */
  minIntervalMs?: number
}

export interface BulkCreateSkippedPair {
  socialAccountId: number
  videoId: number
  /** Причина: 'snapshot_invalid' | 'proxy_unhealthy' | 'idempotency_conflict' | ... */
  code: string
  message: string
}

export interface BulkCreateResponse {
  created: PostingJobDto[]
  skipped: BulkCreateSkippedPair[]
}

// ---- Delete / Bulk-delete / Patch types (полный CRUD) ----

/**
 * Статусы, удаляемые свободно (без confirm/force). preparing/uploading зависят от
 * liveness (startedAt) — здесь их НЕТ. published требует confirm. Зеркалит
 * POSTING_JOB_FREELY_DELETABLE из server/utils/posting/job-service.ts.
 */
export const POSTING_JOB_FREELY_DELETABLE: readonly PostingJobStatus[] = [
  "failed",
  "cancelled",
  "scheduled",
  "queued",
  "retry_queued",
] as const

/** Коды блокировки удаления (data.code в 409). */
export type PostingJobDeleteBlockCode = "published_needs_confirm" | "job_in_flight"

export interface DeletePostingJobRequest {
  /** Подтверждение удаления published (re-post риск). */
  confirm?: boolean
  /** Принудительное удаление свежей in-flight (требует canAdmin). */
  force?: boolean
}

export interface DeletePostingJobResponse {
  id: string
  deleted: true
  status: PostingJobStatus
}

export interface BulkDeleteFilter {
  status?: PostingJobStatus[]
  platform?: PostingPlatform
  socialAccountId?: number
  /** ISO — удалять только созданные раньше этой даты. */
  olderThan?: string
}

export interface BulkDeleteRequest {
  /** Удаление по списку id (взаимоисключающе с filter). Лимит 200. */
  ids?: string[]
  /** Удаление по фильтру (массовая чистка завалов). Лимит 500 кандидатов. */
  filter?: BulkDeleteFilter
  confirm?: boolean
  force?: boolean
}

export interface BulkDeleteSkippedJob {
  id: string
  status: PostingJobStatus
  /**
   * bulk-delete НЕ возвращает "force_requires_admin": force-без-admin не роняет весь
   * bulk (как single-delete 403), а понижается до skip с кодом "job_in_flight"
   * (effectiveOpts.force=false → guard вернёт job_in_flight для свежей in-flight).
   * Поэтому реальные коды только: published_needs_confirm | job_in_flight.
   */
  code: PostingJobDeleteBlockCode
  reason: string
}

export interface BulkDeleteResponse {
  deleted: number
  deletedIds: string[]
  skipped: BulkDeleteSkippedJob[]
}

export interface PatchPostingJobRequest {
  /** ISO или null. Только для status ∈ {scheduled, queued}. */
  scheduledAt?: string | null
  /** 1..10. Только для status ∈ {scheduled, queued}. */
  maxAttempts?: number
}
