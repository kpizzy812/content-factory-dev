/**
 * Shared-типы для Account Warming Planner (Social Automation, итерация 4 — Track E).
 *
 * Дублируем prisma enum'ы (WarmupSessionStatus / Platform), чтобы не тащить generated
 * client в app/. Совместимы с обеими сторонами (server + client).
 */

export type WarmupSessionStatus =
  | "planned"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "skipped"

export const WARMUP_SESSION_STATUSES: readonly WarmupSessionStatus[] = [
  "planned",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "skipped",
] as const

/**
 * Активные статусы — пока возможны переходы. Для фильтров и polling.
 */
export const WARMUP_SESSION_ACTIVE_STATUSES: readonly WarmupSessionStatus[] = [
  "planned",
  "running",
] as const

export type WarmupPlatform = "tiktok" | "instagram" | "youtube"

export const WARMUP_PLATFORMS: readonly WarmupPlatform[] = [
  "tiktok",
  "instagram",
  "youtube",
] as const

/**
 * Возрастной бакет аккаунта по совокупности возраста и числа публикаций.
 * Влияет на шаг распределения action'ов и общую длительность сессии.
 */
export type AccountAgeBucket = "new" | "warming" | "mature"

export const ACCOUNT_AGE_BUCKETS: readonly AccountAgeBucket[] = [
  "new",
  "warming",
  "mature",
] as const

/**
 * Тип одиночного действия в сценарии прогрева.
 *
 * - view: просмотр одиночного видео (длительный engagement).
 * - scroll: лёгкий скроллинг ленты, пропуск контента.
 * - like: лайк ленты / поста.
 * - follow: подписка на аккаунт.
 * - comment: оставить комментарий (только для mature).
 * - share: поделиться (mature, низкая частота).
 * - save: сохранить пост / видео (mature).
 */
export type WarmupActionKind =
  | "view"
  | "scroll"
  | "like"
  | "follow"
  | "comment"
  | "share"
  | "save"

export const WARMUP_ACTION_KINDS: readonly WarmupActionKind[] = [
  "view",
  "scroll",
  "like",
  "follow",
  "comment",
  "share",
  "save",
] as const

/**
 * Discriminated union для одиночного action'а в плане прогрева.
 * Каждый action — атомарный шаг, который runner выполнит последовательно.
 */
export interface WarmupActionBase {
  /** Порядковый номер в массиве actions. 0-based. */
  index: number
  /** Тип действия (discriminator). */
  kind: WarmupActionKind
  /** Длительность в секундах (включая паузы / просмотр). */
  durationSec: number
}

export interface WarmupViewAction extends WarmupActionBase {
  kind: "view"
  /** Ключевое слово, по которому искать ленту/контент. */
  keyword: string
}

export interface WarmupScrollAction extends WarmupActionBase {
  kind: "scroll"
  /** Сколько постов проскроллить (примерно). */
  itemCount: number
}

export interface WarmupLikeAction extends WarmupActionBase {
  kind: "like"
}

export interface WarmupFollowAction extends WarmupActionBase {
  kind: "follow"
  /** Категория для targeting'а аккаунта (general/tech/lifestyle/...). */
  targetCategory: string
}

export interface WarmupCommentAction extends WarmupActionBase {
  kind: "comment"
  /** Текст комментария — выбран из comment-pool на языке аккаунта. */
  text: string
  /** Язык комментария ('ru' | 'en'). */
  language: string
}

export interface WarmupShareAction extends WarmupActionBase {
  kind: "share"
}

export interface WarmupSaveAction extends WarmupActionBase {
  kind: "save"
}

export type WarmupAction =
  | WarmupViewAction
  | WarmupScrollAction
  | WarmupLikeAction
  | WarmupFollowAction
  | WarmupCommentAction
  | WarmupShareAction
  | WarmupSaveAction

/**
 * Метаинформация о плане. Полезна для аудита и UI.
 */
export interface WarmupPlanMeta {
  /** ID аккаунта (для ссылок в логах). */
  socialAccountId: number
  /** Платформа аккаунта. */
  platform: WarmupPlatform
  /** Возрастной бакет. */
  ageBucket: AccountAgeBucket
  /** Используемый язык комментариев ('ru' | 'en'). */
  commentLanguage: string
  /** Seed, использованный для генерации (для воспроизводимости). */
  seed: string
  /** Целевая длительность по бакету (секунды). */
  targetDurationSec: number
  /** Фактическая суммарная длительность всех actions. */
  totalDurationSec: number
  /** Сколько action'ов в плане. */
  actionCount: number
  /** Сколько ключевых слов взято из pool. 0 если pool пуст и использован fallback. */
  keywordPoolSize: number
  /** Когда план сгенерирован. */
  generatedAt: string
}

export interface WarmupPlan {
  meta: WarmupPlanMeta
  actions: WarmupAction[]
}

/**
 * Лог одиночного выполненного action'а (заполнит runner в итерации 4).
 */
export interface WarmupExecutionLog {
  index: number
  kind: WarmupActionKind
  startedAt: string
  finishedAt: string
  status: "ok" | "skipped" | "failed"
  errorMessage?: string
}

/**
 * DTO для списка / детали WarmupSession (выдаёт API).
 */
export interface WarmupSessionDto {
  id: string
  socialAccountId: number
  status: WarmupSessionStatus
  scheduledAt: string
  dayKey: string
  seed: string
  ageBucket: AccountAgeBucket
  plan: WarmupPlan
  executedActions: WarmupExecutionLog[] | null
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  createdById: number | null
  createdAt: string
  updatedAt: string
  socialAccount?: {
    id: number
    displayName: string
    platform: WarmupPlatform
    appId: number
  } | null
}

export interface WarmupSessionListResponse {
  items: WarmupSessionDto[]
  total: number
}

export interface WarmupKeywordPoolDto {
  id: string
  name: string
  appId: number | null
  language: string | null
  category: string
  platform: WarmupPlatform | null
  keywords: string[]
  hashtags: string[]
  isActive: boolean
  createdById: number | null
  createdAt: string
  updatedAt: string
}

export interface WarmupKeywordPoolListResponse {
  items: WarmupKeywordPoolDto[]
  total: number
}
