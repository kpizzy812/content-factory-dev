/**
 * Унифицированный формат записи журнала для /admin/logs.
 * Аггрегирует 8 разнородных таблиц (AgentLog, AppEnrichmentLog, SecretAccessLog,
 * TelegramCommandAudit, TrendwatcherRunLog, WebhookLog, AiAuditLog, PostingJobLog)
 * в общий вид с источником, уровнем и опциональной ссылкой на сущность.
 */

export type AdminLogSource =
  | "agent"
  | "app_enrichment"
  | "secret_access"
  | "telegram_command"
  | "trendwatcher_run"
  | "webhook"
  | "ai_audit"
  | "posting_job"

export type AdminLogLevel = "info" | "warn" | "error"

export interface AdminLogRefLink {
  /** Тип сущности для ссылки в UI: cycle | app | pipeline | trendwatcher_run | telegram_chat | posting_job | secret_entity */
  type: string
  /** ID сущности (число или строка для cuid) */
  id: string | number
  /** URL для NuxtLink, если применимо */
  href?: string
  /** Видимая подпись бейджа: «Цикл #12», «Приложение #3» */
  label: string
}

export interface AdminLogEntry {
  /** Композитный id вида "agent:42" — для key в v-for, не для DB-операций. */
  id: string
  source: AdminLogSource
  level: AdminLogLevel
  /** Логический модуль: trendwatcher | telegram | webhook | secret-access | app-enrichment | ... */
  module: string
  /** Заголовок записи (одной строкой). */
  message: string
  /** Расширенные детали — JSON-блок (raw payload, args). */
  details?: unknown
  /** Только для AgentLog: возможно отметить как resolved. */
  resolved?: boolean
  /** Числовой id внутри своей таблицы — для PUT /resolve и тп. */
  rawId: string | number
  /** Связанная сущность для перехода. */
  ref?: AdminLogRefLink
  /**
   * Кто это сделал: человек или сам завод.
   *
   * Макет админки помечает действия людей отдельно — их читают, когда
   * разбираются «кто остановил запуск» и «кто поменял баланс». Отдельной
   * таблицы аудита нет и не заводилось: почти все такие записи уже несут
   * `userId`, и признак выводится из него, а не выдумывается.
   */
  actor?: 'human' | 'system'
  /** Кто именно, если известно. */
  actorUserId?: number
  /** ISO-дата создания. */
  createdAt: string
}

export interface AdminLogsResponse {
  data: AdminLogEntry[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
    /** Сколько записей вытянуто из каждого источника (debug / sanity-проверка). */
    sourceCounts: Record<AdminLogSource, number>
  }
}

/**
 * Подписи источников для UI. Используются и в filters, и в badge.
 */
export const ADMIN_LOG_SOURCE_LABELS: Record<AdminLogSource, string> = {
  agent: "Агенты",
  app_enrichment: "App enrichment",
  secret_access: "Секреты",
  telegram_command: "Telegram",
  trendwatcher_run: "Trendwatcher",
  webhook: "Webhooks",
  ai_audit: "AI audit",
  posting_job: "Posting",
}

export const ADMIN_LOG_SOURCE_ICONS: Record<AdminLogSource, string> = {
  agent: "mingcute:robot-line",
  app_enrichment: "mingcute:box-line",
  secret_access: "mingcute:key-2-line",
  telegram_command: "mingcute:send-plane-line",
  trendwatcher_run: "mingcute:radar-line",
  webhook: "mingcute:link-line",
  ai_audit: "mingcute:ai-line",
  posting_job: "mingcute:upload-line",
}

export const ADMIN_LOG_SOURCES_ALL: AdminLogSource[] = [
  "agent",
  "app_enrichment",
  "secret_access",
  "telegram_command",
  "trendwatcher_run",
  "webhook",
  "ai_audit",
  "posting_job",
]
