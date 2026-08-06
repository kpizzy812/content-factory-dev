import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Статусы производственного цикла в общем словаре системы.
 * Один маппер на список и на деталь — иначе они расходятся.
 */
export const CYCLE_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  pending: 'queued',
  running: 'running',
  completed: 'done',
  failed: 'failed',
  stopped: 'cancelled',
}

export const CYCLE_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает',
  running: 'Работает',
  completed: 'Завершён',
  failed: 'Упал',
  stopped: 'Остановлен',
}

export function cycleStatus(raw: string | null | undefined): EntityStatus {
  return CYCLE_STATUS_TO_ENTITY[raw ?? ''] ?? 'draft'
}
