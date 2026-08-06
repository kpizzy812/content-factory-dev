import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Приведение статусов публикации к общему словарю системы.
 *
 * `blocked_by_env` — это не ошибка загрузки, а выключенный переключатель
 * постинга: задача цела и уедет, как только зону включат.
 */
export const UPLOAD_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  pending: 'queued',
  scheduled: 'queued',
  uploading: 'running',
  published: 'done',
  failed: 'failed',
  canceled: 'cancelled',
  blocked_by_env: 'blocked',
}

export const UPLOAD_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает',
  scheduled: 'Запланирована',
  uploading: 'Загружается',
  published: 'Опубликована',
  failed: 'Ошибка',
  canceled: 'Отменена',
  blocked_by_env: 'Постинг выключен',
}

export function uploadStatus(raw: string | null | undefined): EntityStatus {
  return UPLOAD_STATUS_TO_ENTITY[raw ?? ''] ?? 'draft'
}
