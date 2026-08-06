import type { WarmupSessionStatus } from '~~/shared/types/warmup'
import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Статусы сессии прогрева в общем словаре системы.
 *
 * «Частично» и «Пропущено» из словаря не выводятся: первое — это завершённая
 * сессия с недоделанными действиями, второе — сознательный пропуск дня. Тон
 * берём общий, подписи оставляем доменные.
 */
export const WARMUP_STATUS_TO_ENTITY: Record<WarmupSessionStatus, EntityStatus> = {
  planned: 'queued',
  running: 'running',
  completed: 'done',
  partial: 'review',
  failed: 'failed',
  cancelled: 'cancelled',
  skipped: 'cancelled',
}

export const WARMUP_STATUS_LABELS: Record<WarmupSessionStatus, string> = {
  planned: 'Запланирована',
  running: 'Выполняется',
  completed: 'Завершена',
  partial: 'Выполнена частично',
  failed: 'Упала',
  cancelled: 'Отменена',
  skipped: 'Пропущена',
}

export function warmupStatus(raw: string | null | undefined): EntityStatus {
  return WARMUP_STATUS_TO_ENTITY[(raw ?? '') as WarmupSessionStatus] ?? 'draft'
}
