/**
 * Приведение статусов запуска и шага к общему словарю системы.
 *
 * Из словаря берётся только тон: доменные подписи точнее общих. «Нет данных» —
 * не «На ревью»: конвейер отработал, но источник ничего не отдал, и решение
 * оператора тут не требуется. «Пропущен» — не «Отменено»: шаг сознательно
 * обойдён предыдущим условием.
 *
 * `shared/utils/pipeline-status` остаётся на месте — он вне границ переноса и
 * хранит имена классов DaisyUI, которых после этапа 0 не существует.
 */
import type { EntityStatus } from '~~/shared/utils/entity-status'

export interface RunStatusMeta {
  entity: EntityStatus
  label: string
  icon: string
  /** Идёт прямо сейчас — иконка крутится, точка пульсирует. */
  live?: boolean
}

/** Статус запуска целиком. */
export const RUN_STATUS_META: Record<string, RunStatusMeta> = {
  pending: { entity: 'queued', label: 'В очереди', icon: 'mingcute:sandglass-line' },
  running: { entity: 'running', label: 'Выполняется', icon: 'mingcute:loading-line', live: true },
  success: { entity: 'done', label: 'Готово', icon: 'mingcute:check-line' },
  no_data: { entity: 'review', label: 'Нет данных', icon: 'mingcute:inbox-line' },
  failed: { entity: 'failed', label: 'Упал', icon: 'mingcute:alert-line' },
  cancelled: { entity: 'cancelled', label: 'Остановлен', icon: 'mingcute:forbid-circle-line' },
}

/** Статус отдельного шага. Набор шире: у шага есть частичный успех и блокировка. */
export const STEP_STATUS_META: Record<string, RunStatusMeta> = {
  pending: { entity: 'queued', label: 'в очереди', icon: 'mingcute:time-line' },
  running: { entity: 'running', label: 'идёт', icon: 'mingcute:loading-line', live: true },
  success: { entity: 'done', label: 'готово', icon: 'mingcute:check-line' },
  partial: { entity: 'review', label: 'частично', icon: 'mingcute:alert-line' },
  no_data: { entity: 'review', label: 'нет данных', icon: 'mingcute:inbox-line' },
  failed: { entity: 'failed', label: 'ошибка', icon: 'mingcute:alert-line' },
  skipped: { entity: 'cancelled', label: 'пропущен', icon: 'mingcute:skip-forward-line' },
  cancelled: { entity: 'cancelled', label: 'отменён', icon: 'mingcute:forbid-circle-line' },
  blocked: { entity: 'blocked', label: 'заблокирован', icon: 'mingcute:forbid-circle-line' },
  waiting: { entity: 'queued', label: 'ждёт события', icon: 'mingcute:time-line' },
}

const UNKNOWN: RunStatusMeta = {
  entity: 'draft',
  label: 'неизвестно',
  icon: 'mingcute:question-line',
}

export function runStatusMeta(raw: string | null | undefined): RunStatusMeta {
  return RUN_STATUS_META[raw ?? ''] ?? UNKNOWN
}

export function stepStatusMeta(raw: string | null | undefined): RunStatusMeta {
  return STEP_STATUS_META[raw ?? ''] ?? UNKNOWN
}

/** Тон бейджа по состоянию из общего словаря. */
export const STATUS_TONE: Record<EntityStatus, string> = {
  draft: 'border-neutral-border bg-neutral-bg text-neutral',
  queued: 'border-neutral-border bg-neutral-bg text-neutral',
  running: 'border-info-border bg-info-bg text-info',
  review: 'border-warning-border bg-warning-bg text-warning',
  done: 'border-success-border bg-success-bg text-success',
  failed: 'border-danger-border bg-danger-bg text-danger',
  blocked: 'border-danger-border bg-surface text-danger',
  cancelled: 'border-divider bg-transparent text-subtle',
}

/** Только цвет — для полосок прогресса и обводки строки шага. */
export const STATUS_FILL: Record<EntityStatus, string> = {
  draft: 'bg-neutral-bg',
  queued: 'bg-neutral-bg',
  running: 'bg-info',
  review: 'bg-warning',
  done: 'bg-success',
  failed: 'bg-danger',
  blocked: 'bg-danger',
  cancelled: 'bg-neutral-bg',
}

export const TRIGGER_LABELS: Record<string, string> = {
  manual: 'вручную',
  schedule: 'расписание',
  webhook: 'вебхук',
}

export function triggerLabel(raw: string | null | undefined): string {
  return TRIGGER_LABELS[raw ?? ''] ?? (raw || 'неизвестно')
}

export const ERROR_CATEGORY_LABELS: Record<string, string> = {
  validation: 'валидация',
  runtime: 'исполнение',
  external_api: 'внешний API',
  permission: 'доступ',
  timeout: 'таймаут',
  cancellation: 'отмена',
  dependency_failure: 'зависимость',
  configuration: 'конфигурация',
  unknown: 'неизвестно',
}

export function errorCategoryLabel(raw: string | null | undefined): string {
  return ERROR_CATEGORY_LABELS[raw ?? ''] ?? (raw || '')
}
