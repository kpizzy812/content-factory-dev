import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Приведение статусов тренда к общему словарю системы.
 *
 * Доменные значения остаются как есть в API и БД — меняется только их подача.
 * Такой маппер заводится по одному на сущность; новых цветов при этом не
 * появляется, иначе смысл единой семантики теряется.
 */
export const TREND_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  new: 'queued',
  reviewed: 'review',
  in_work: 'running',
  completed: 'done',
  dismissed: 'cancelled',
}

export const TREND_STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  reviewed: 'Просмотрен',
  in_work: 'В работе',
  completed: 'Готов',
  dismissed: 'Отклонён',
}

export function trendStatus(raw: string | null | undefined): EntityStatus {
  return TREND_STATUS_TO_ENTITY[raw ?? ''] ?? 'draft'
}
