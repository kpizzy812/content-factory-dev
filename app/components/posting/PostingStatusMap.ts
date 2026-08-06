import type { PostingJobStatus } from '~~/shared/types/posting-job'
import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Статусы задачи постинга в общем словаре системы.
 *
 * «Подготовка» и «Загрузка» — это одно состояние «идёт прямо сейчас»; «повтор»
 * системный словарь тоже схлопывает, но для оператора это важное отличие от
 * ошибки: повтор произойдёт сам. Поэтому подписи здесь доменные.
 */
export const POSTING_STATUS_TO_ENTITY: Record<PostingJobStatus, EntityStatus> = {
  scheduled: 'queued',
  queued: 'queued',
  preparing: 'running',
  uploading: 'running',
  published: 'done',
  failed: 'failed',
  retry_queued: 'review',
  cancelled: 'cancelled',
}

export const POSTING_STATUS_LABELS: Record<PostingJobStatus, string> = {
  scheduled: 'В плане',
  queued: 'В очереди',
  preparing: 'Готовится',
  uploading: 'Отправляется',
  published: 'Опубликовано',
  failed: 'Упала',
  retry_queued: 'Повтор',
  cancelled: 'Снята',
}

export function postingStatus(raw: string | null | undefined): EntityStatus {
  return POSTING_STATUS_TO_ENTITY[(raw ?? '') as PostingJobStatus] ?? 'draft'
}

/**
 * Категории ошибок публикации человеческим языком. Категорию отдаёт сервер,
 * и она объясняет, повторится задача сама или ждёт человека.
 */
export const POSTING_ERROR_LABELS: Record<string, string> = {
  auth_failed: 'платформа не приняла токен',
  proxy_dead: 'прокси не отвечает',
  network_error: 'сеть не дошла до платформы',
  platform_5xx: 'платформа ответила ошибкой на своей стороне',
  platform_validation: 'платформа отклонила содержимое',
  platform_rate_limit: 'упёрлись в лимит платформы',
  content_rejected: 'ролик отклонён модерацией',
  account_locked: 'аккаунт заблокирован платформой',
  internal_error: 'ошибка на нашей стороне',
  unknown: 'причина неизвестна',
  login_required: 'нужен вход в аккаунт на устройстве',
  browser_connect_failed: 'не удалось подключиться к устройству',
  selector_not_found: 'интерфейс платформы изменился',
  upload_failed: 'загрузка файла не завершилась',
}
