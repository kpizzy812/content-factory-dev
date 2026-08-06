/**
 * Приведение статусов запуска парсинга к общему словарю системы.
 *
 * Из словаря берётся только тон: доменные подписи точнее общих. У парсинга
 * четыре разных «выполняется» — Apify собирает, идёт импорт, идёт анализ, — и
 * оператор по ним понимает, сколько ещё ждать. Схлопывать их в одно
 * «Выполняется» значит выкинуть единственную полезную информацию.
 */
import type { EntityStatus } from '~~/shared/utils/entity-status'

export interface TrendRunStatusMeta {
  entity: EntityStatus
  label: string
}

export const TREND_RUN_STATUS_META: Record<string, TrendRunStatusMeta> = {
  pending: { entity: 'queued', label: 'Ожидание' },
  starting: { entity: 'queued', label: 'Запускается' },
  running: { entity: 'running', label: 'Apify работает' },
  importing: { entity: 'running', label: 'Импорт трендов' },
  analyzing: { entity: 'running', label: 'Анализ' },
  completed: { entity: 'done', label: 'Завершён' },
  partially_completed: { entity: 'review', label: 'Частично' },
  failed: { entity: 'failed', label: 'Ошибка' },
  canceled: { entity: 'cancelled', label: 'Отменён' },
}

export function trendRunStatus(raw: string | null | undefined): TrendRunStatusMeta {
  return TREND_RUN_STATUS_META[raw ?? ''] ?? { entity: 'draft', label: raw || 'неизвестно' }
}

/** Идёт прямо сейчас — по этим состояниям крутится индикатор и работает опрос. */
export const TREND_RUN_ACTIVE = new Set(['pending', 'starting', 'running', 'importing', 'analyzing'])

export function isTrendRunActive(status: string | null | undefined): boolean {
  return TREND_RUN_ACTIVE.has(status ?? '')
}

/**
 * Состояние проверки конфигурации профиля. Отдельно от статуса запуска:
 * «конфиг не проверен» — это не «черновик» и не «ошибка», это отсутствие
 * знания, и запуск при нём разрешён.
 */
export function profileValidation(status: string | null | undefined): {
  entity: EntityStatus
  label: string
  icon: string
} {
  if (!status) return { entity: 'draft', label: 'Не проверен', icon: 'mingcute:question-line' }
  if (status === 'valid') return { entity: 'done', label: 'Конфиг в порядке', icon: 'mingcute:check-line' }
  return { entity: 'failed', label: 'Ошибка конфига', icon: 'mingcute:alert-line' }
}
