/**
 * Единая семантика статусов для всех сущностей системы.
 *
 * До перестройки фронта у каждой сущности был свой набор строк и свой набор
 * цветов для одного и того же смысла — 15 разных badge-компонентов. Здесь
 * общий словарь из восьми состояний; доменные сущности приводят к нему свои
 * значения собственными мапперами, а не заводят новые цвета.
 */
export const ENTITY_STATUSES = [
  'draft',
  'queued',
  'running',
  'review',
  'done',
  'failed',
  'blocked',
  'cancelled',
] as const

export type EntityStatus = (typeof ENTITY_STATUSES)[number]

/** Тон из палитры статусов; `muted` — приглушённая подача. */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface StatusMeta {
  label: string
  tone: StatusTone
  icon: string
  /** Приглушённая подача: пунктирная граница или прозрачный фон. */
  muted?: boolean
  /** Пульсирующая точка — только у того, что идёт прямо сейчас. */
  live?: boolean
}

export const ENTITY_STATUS_META: Record<EntityStatus, StatusMeta> = {
  draft: { label: 'Черновик', tone: 'neutral', icon: 'mingcute:edit-line' },
  queued: { label: 'В очереди', tone: 'neutral', icon: 'mingcute:time-line' },
  running: { label: 'Выполняется', tone: 'info', icon: 'mingcute:loading-line', live: true },
  review: { label: 'На ревью', tone: 'warning', icon: 'mingcute:eye-line' },
  done: { label: 'Готово', tone: 'success', icon: 'mingcute:check-line' },
  failed: { label: 'Ошибка', tone: 'danger', icon: 'mingcute:close-line' },
  blocked: { label: 'Заблокировано', tone: 'danger', icon: 'mingcute:lock-line', muted: true },
  cancelled: { label: 'Отменено', tone: 'neutral', icon: 'mingcute:forbid-circle-line', muted: true },
}

export function isEntityStatus(value: string): value is EntityStatus {
  return (ENTITY_STATUSES as readonly string[]).includes(value)
}
