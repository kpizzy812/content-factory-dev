import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Состояние остатка на сервисе к общему словарю системы.
 *
 * Подписи доменные: «Заканчивается» точнее, чем «На ревью», а «Нет данных» —
 * это не «Черновик»: остаток просто не вводили и автосбора у сервиса нет.
 * Из словаря берётся только тон.
 */
export interface BalanceStatusMeta {
  entity: EntityStatus
  label: string
  tone: string
}

const META: Record<string, BalanceStatusMeta> = {
  ok: { entity: 'done', label: 'Хватает', tone: 'border-success-border bg-success-bg text-success' },
  low: { entity: 'review', label: 'Заканчивается', tone: 'border-warning-border bg-warning-bg text-warning' },
  critical: { entity: 'failed', label: 'На нуле', tone: 'border-danger-border bg-danger-bg text-danger' },
  error: { entity: 'failed', label: 'Ошибка сбора', tone: 'border-danger-border bg-danger-bg text-danger' },
  unknown: { entity: 'draft', label: 'Нет данных', tone: 'border-divider bg-transparent text-subtle' },
}

const FALLBACK: BalanceStatusMeta = META.unknown!

export function balanceStatus(raw: string | null | undefined): BalanceStatusMeta {
  return META[raw ?? ''] ?? FALLBACK
}

/** Откуда взято значение. «Авто» и «Руками» — разные степени доверия. */
export const BALANCE_SOURCE_LABELS: Record<string, string> = {
  api: 'из API',
  manual: 'введено руками',
  estimate: 'расчёт от базы',
  fallback: 'последнее известное',
}
