import type { EntityStatus } from '~~/shared/utils/entity-status'

/** Приведение статусов сценария и его вариантов к общему словарю системы. */
export const SCENARIO_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  draft: 'draft',
  generating: 'running',
  generated: 'review',
  selected: 'done',
  rejected: 'cancelled',
  needs_rework: 'blocked',
  archived: 'cancelled',
}

export const SCENARIO_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  generating: 'Генерируется',
  generated: 'Ждёт выбора',
  selected: 'Вариант выбран',
  rejected: 'Отклонён',
  needs_rework: 'На доработку',
  archived: 'В архиве',
}

export const VARIANT_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  draft: 'draft',
  accepted: 'done',
  rejected: 'cancelled',
  needs_rework: 'blocked',
  superseded: 'cancelled',
}

export const VARIANT_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  accepted: 'Принят',
  rejected: 'Отклонён',
  needs_rework: 'На доработку',
  superseded: 'Заменён',
}

export function scenarioStatus(raw: string | null | undefined): EntityStatus {
  return SCENARIO_STATUS_TO_ENTITY[raw ?? ''] ?? 'draft'
}

export function variantStatus(raw: string | null | undefined): EntityStatus {
  return VARIANT_STATUS_TO_ENTITY[raw ?? ''] ?? 'draft'
}
