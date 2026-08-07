/**
 * Лимит публикаций площадки в строке аккаунта.
 *
 * Величину отдаёт только Instagram и только в момент отправки, поэтому в базе
 * лежит снимок со временем замера. Отсюда три разных состояния, и путать их
 * нельзя: «замера нет» — мы не спрашивали, «замер протух» — цифра со вчера,
 * «квота исчерпана» — публиковать сейчас нельзя.
 */

export interface QuotaAccount {
  publishingQuotaUsage?: number | null
  publishingQuotaTotal?: number | null
  publishingQuotaAt?: string | null
  publishingQuotaStale?: boolean
}

export function hasQuota(account: QuotaAccount): boolean {
  return account.publishingQuotaUsage != null && account.publishingQuotaTotal != null
}

/** «34 / 50» либо прочерк: ноль здесь означал бы «публиковать нельзя». */
export function quotaLabel(account: QuotaAccount): string {
  if (!hasQuota(account)) return '—'
  return `${account.publishingQuotaUsage} / ${account.publishingQuotaTotal}`
}

export function quotaTone(account: QuotaAccount): string {
  if (!hasQuota(account)) return 'text-subtle'
  if (account.publishingQuotaStale) return 'text-subtle'
  const usage = account.publishingQuotaUsage ?? 0
  const total = account.publishingQuotaTotal ?? 0
  if (total > 0 && usage >= total) return 'text-danger'
  if (total > 0 && usage / total >= 0.8) return 'text-warning'
  return 'text-fg'
}

/** Подсказка объясняет, откуда цифра и насколько ей можно верить. */
export function quotaTitle(account: QuotaAccount): string {
  if (!hasQuota(account)) {
    return 'Площадка отдаёт лимит только в момент публикации. Пока с этого аккаунта не публиковали, замера нет.'
  }
  const when = account.publishingQuotaAt
    ? new Date(account.publishingQuotaAt).toLocaleString('ru-RU')
    : 'неизвестно когда'
  return account.publishingQuotaStale
    ? `Замер от ${when}: старше суток, квота площадки за это время уже откатилась.`
    : `Замер от ${when}, в момент последней публикации.`
}
