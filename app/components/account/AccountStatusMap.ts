import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Статус социального аккаунта в общем словаре системы.
 *
 * В базе живут только три значения (`AccountStatus`): активен, токен истёк,
 * доступ отозван. Ни «лимита», ни «паузы», ни «прогрева» из макета в модели нет —
 * их источник (`content_publishing_limit`, пул прогрева) не выведен ни в один
 * endpoint, поэтому здесь их нет тоже.
 */
export const ACCOUNT_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  active: 'done',
  expired: 'review',
  revoked: 'blocked',
}

/**
 * Доменная подпись точнее общей: «Токен истёк» говорит оператору, что чинить,
 * а «На ревью» — нет. Из словаря берём только тон.
 */
export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  expired: 'Токен истёк',
  revoked: 'Доступ отозван',
}

export function accountStatus(raw: string | null | undefined): EntityStatus {
  return ACCOUNT_STATUS_TO_ENTITY[raw ?? ''] ?? 'draft'
}

/** Метод постинга — не статус, но читается в той же колонке. */
export const POSTING_METHOD_LABELS: Record<string, string> = {
  api: 'официальный API',
  browser_automation: 'автоматизация устройства',
}

/** Токен считается истекающим за трое суток до даты в `expiresAt`. */
export const TOKEN_EXPIRY_WARN_MS = 3 * 24 * 60 * 60 * 1000

export type TokenState = 'ok' | 'soon' | 'gone' | 'unknown'

export function tokenState(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
): TokenState {
  if (status !== 'active') return 'gone'
  if (!expiresAt) return 'unknown'
  const left = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(left)) return 'unknown'
  if (left <= 0) return 'gone'
  return left <= TOKEN_EXPIRY_WARN_MS ? 'soon' : 'ok'
}
