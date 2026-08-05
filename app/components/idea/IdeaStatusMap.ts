import type { EntityStatus } from '~~/shared/utils/entity-status'

/** Приведение статусов идеи к общему словарю системы. */
export const IDEA_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  pending: 'queued',
  processing: 'running',
  ready: 'review',
  in_work: 'running',
  completed: 'done',
  failed: 'failed',
}

export const IDEA_STATUS_LABELS: Record<string, string> = {
  pending: 'В очереди',
  processing: 'Разбирается',
  ready: 'Разобрана',
  in_work: 'В работе',
  completed: 'Готова',
  failed: 'Ошибка',
}

/** Разбор идеи моделью — отдельная от статуса идеи величина. */
export const IDEA_ANALYSIS_TO_ENTITY: Record<string, EntityStatus> = {
  none: 'draft',
  pending: 'queued',
  processing: 'running',
  completed: 'done',
  failed: 'failed',
}

export const IDEA_SOURCE_LABELS: Record<string, string> = {
  manual: 'Вручную',
  telegram: 'Telegram',
  pipeline: 'Конвейер',
  marketingcamp: 'MarketingCamp',
}

export const IDEA_SYNC_LABELS: Record<string, string> = {
  synced: 'Синхронизировано',
  conflict: 'Конфликт',
  error: 'Ошибка синхронизации',
  pending_export: 'Ждёт выгрузки',
  pending_import: 'Ждёт загрузки',
}

export function ideaStatus(raw: string | null | undefined): EntityStatus {
  return IDEA_STATUS_TO_ENTITY[raw ?? ''] ?? 'draft'
}

export function ideaAnalysisStatus(raw: string | null | undefined): EntityStatus {
  return IDEA_ANALYSIS_TO_ENTITY[raw ?? ''] ?? 'draft'
}
