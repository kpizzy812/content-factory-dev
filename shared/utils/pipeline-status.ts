/**
 * Pipeline status/trigger/error config — single source of truth.
 * Used across PipelineRunCard, RunsModal, runs pages, NodeLastRun, etc.
 */

export interface StatusEntry {
  class: string
  label: string
  icon: string
  /** bg + text classes for the round status indicator */
  indicator: string
}

export const pipelineRunStatusConfig: Record<string, StatusEntry> = {
  pending: { class: 'badge-warning', label: 'Ожидание', icon: 'mingcute:sandglass-line', indicator: 'bg-warning/15 text-warning' },
  running: { class: 'badge-info', label: 'Выполняется', icon: 'mingcute:refresh-2-line', indicator: 'bg-info/15 text-info' },
  success: { class: 'badge-success', label: 'Успешно', icon: 'mingcute:check-circle-line', indicator: 'bg-success/15 text-success' },
  no_data: { class: 'badge-warning badge-outline', label: 'Нет данных', icon: 'mingcute:inbox-line', indicator: 'bg-warning/15 text-warning' },
  partial: { class: 'badge-warning', label: 'Частично', icon: 'mingcute:alert-line', indicator: 'bg-warning/15 text-warning' },
  failed: { class: 'badge-error', label: 'Ошибка', icon: 'mingcute:close-circle-line', indicator: 'bg-error/15 text-error' },
  timeout: { class: 'badge-error badge-outline', label: 'Таймаут', icon: 'mingcute:time-line', indicator: 'bg-error/15 text-error' },
  skipped: { class: 'badge-ghost', label: 'Пропущен', icon: 'mingcute:skip-forward-line', indicator: 'bg-base-200 text-base-content/40' },
  cancelled: { class: 'badge-neutral', label: 'Отменён', icon: 'mingcute:close-circle-line', indicator: 'bg-neutral/15 text-neutral' },
  blocked: { class: 'badge-warning', label: 'Заблокирован', icon: 'mingcute:forbid-circle-line', indicator: 'bg-warning/15 text-warning' },
  waiting: { class: 'badge-info badge-outline', label: 'Ожидает', icon: 'mingcute:time-line', indicator: 'bg-info/15 text-info' },
}

export const fallbackStatus: StatusEntry = {
  class: 'badge-ghost',
  label: '?',
  icon: 'mingcute:question-line',
  indicator: 'bg-base-200 text-base-content/40',
}

export function getRunStatus(status: string): StatusEntry {
  return pipelineRunStatusConfig[status] ?? fallbackStatus
}

export const triggerConfig: Record<string, { label: string; icon: string }> = {
  manual: { label: 'Вручную', icon: 'mingcute:cursor-3-line' },
  schedule: { label: 'По расписанию', icon: 'mingcute:calendar-time-add-line' },
  webhook: { label: 'Webhook', icon: 'mingcute:link-line' },
}

export function getTrigger(type: string) {
  return triggerConfig[type] ?? { label: type, icon: 'mingcute:question-line' }
}

export const errorCategoryLabels: Record<string, string> = {
  validation: 'Валидация',
  runtime: 'Runtime',
  external_api: 'API',
  permission: 'Доступ',
  timeout: 'Таймаут',
  cancellation: 'Отмена',
  dependency_failure: 'Зависимость',
  configuration: 'Конфиг',
  unknown: '?',
}

export function getErrorCategoryLabel(cat: string): string {
  return errorCategoryLabels[cat] ?? cat
}
