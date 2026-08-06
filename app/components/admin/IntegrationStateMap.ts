/**
 * Состояние интеграции к общему словарю системы.
 *
 * Из словаря берётся только тон: доменные подписи точнее общих. «Мок-режим» —
 * не «черновик» и не «готово»: это стенд, где ключ не проверялся, и человеку
 * важно знать именно это. «Не настроен» — не ошибка: сервис может быть просто
 * не нужен на этом контуре.
 */
import type { EntityStatus } from '~~/shared/utils/entity-status'

export const INTEGRATION_STATE_META = {
  ok: { entity: 'done' as EntityStatus, label: 'отвечает', icon: 'mingcute:check-line' },
  error: { entity: 'failed' as EntityStatus, label: 'не отвечает', icon: 'mingcute:alert-line' },
  not_configured: { entity: 'draft' as EntityStatus, label: 'не настроен', icon: 'mingcute:question-line' },
  mock: { entity: 'cancelled' as EntityStatus, label: 'мок-режим', icon: 'mingcute:flask-line' },
  skipped: { entity: 'cancelled' as EntityStatus, label: 'не проверялся', icon: 'mingcute:minimize-line' },
}

export type IntegrationStateKey = keyof typeof INTEGRATION_STATE_META

export function integrationState(raw: string | null | undefined) {
  return INTEGRATION_STATE_META[(raw ?? '') as IntegrationStateKey]
    ?? INTEGRATION_STATE_META.skipped
}
