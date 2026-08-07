/**
 * Свободная ёмкость публикаций и прогноз восстановления лимита.
 *
 * Два разных источника, и смешивать их нельзя.
 *
 * Первый — агрегат площадки: `content_publishing_limit` Instagram, снимок
 * которого мы сохраняем в момент отправки. Он главнее всего остального, но
 * есть только у Instagram и только с той свежестью, с какой мы публиковали.
 *
 * Второй — наша собственная история публикаций за сутки. Из неё считается
 * прогноз: квота Instagram катится 24 часа, поэтому публикация, сделанная в
 * 14:02, освобождает слот в 14:02 следующего дня. Это именно прогноз, и
 * подписан он так же — по нашим данным, а не по ответу площадки.
 */

import type {
  AccountCapacityRow,
  CapacityRecoveryPoint,
  PublishingCapacity,
} from '~~/shared/types/account-capacity'
import { prisma } from '../prisma'
import { isLimitStale } from '../social/publishing-limit'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/**
 * Текст, которым адаптер Instagram сообщает об исчерпанной квоте
 * (`server/utils/social/instagram.ts`). Отдельная константа, потому что это
 * единственный признак, по которому «слот занят» отличается от настоящего
 * провала публикации.
 */
const QUOTA_EXHAUSTED_PATTERN = /publishing quota exhausted|квота публикаций исчерпана/i

/** Минимальная пауза перед переносом, см. `planQuotaDeferral`. */
const QUOTA_RETRY_FLOOR_MS = 5 * 60_000

/**
 * Квота исчерпана — это не провал попытки, а «сейчас нельзя».
 * Считать это провалом означает сжечь три автопопытки за 80 минут, тогда как
 * лимит катится 24 часа и за это время не восстановится.
 */
export function isPublishingQuotaExhausted(message: string | null | undefined): boolean {
  if (!message) return false
  return QUOTA_EXHAUSTED_PATTERN.test(message)
}

/**
 * Момент, к которому по прогнозу освободится `needed` слотов.
 *
 * Прогноз почасовой и накопительный: публикация, сделанная в T, освобождает
 * слот в T + 24 часа, поэтому нужное число слотов набирается суммой корзин.
 * null — за ближайшие сутки столько не наберётся, переносить не на что.
 */
export function nextRecoveryAt(
  recovery: CapacityRecoveryPoint[],
  needed = 1,
): string | null {
  const required = Math.max(1, Math.trunc(needed))
  let accumulated = 0
  for (const point of [...recovery].sort((a, b) => a.hour.localeCompare(b.hour))) {
    accumulated += Math.max(0, point.recovered)
    if (accumulated >= required) return point.hour
  }
  return null
}

export type QuotaDeferral =
  | { defer: false }
  | { defer: true; retryAt: Date }

/**
 * Решение по упавшей из-за квоты публикации: перенести на момент
 * восстановления слота вместо терминального провала.
 *
 * Когда прогноза нет (публикаций за сутки мы не видели — например, лимит
 * выбрали не через нашу систему), переносим на час вперёд: это дешевле, чем
 * потерять публикацию, и не превращается в busy-loop.
 */
export function planQuotaDeferral(input: {
  errorMessage: string | null | undefined
  recovery?: CapacityRecoveryPoint[]
  fullyRecoveredAt?: string | null
  now?: Date
}): QuotaDeferral {
  if (!isPublishingQuotaExhausted(input.errorMessage)) return { defer: false }

  const now = input.now ?? new Date()
  const forecast = nextRecoveryAt(input.recovery ?? [], 1) ?? input.fullyRecoveredAt ?? null
  const forecastMs = forecast ? new Date(forecast).getTime() : Number.NaN
  // Прогноз почасовой, корзина текущего часа уже могла пройти — пятиминутный
  // пол не даёт превратить перенос в мгновенный повторный заход в ту же квоту.
  const retryAtMs = Number.isFinite(forecastMs)
    ? Math.max(forecastMs, now.getTime() + QUOTA_RETRY_FLOOR_MS)
    : now.getTime() + HOUR_MS

  return { defer: true, retryAt: new Date(retryAtMs) }
}

export interface CapacityFilters {
  appId?: number | null
  platform?: string | null
}

export async function computePublishingCapacity(
  filters: CapacityFilters = {},
  now: Date = new Date(),
): Promise<PublishingCapacity> {
  const since = new Date(now.getTime() - DAY_MS)

  const where = {
    status: 'active' as const,
    ...(filters.appId ? { appId: filters.appId } : {}),
    ...(filters.platform ? { platform: filters.platform as never } : {}),
  }

  const [accounts, uploads] = await Promise.all([
    prisma.socialAccount.findMany({
      where,
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        displayName: true,
        platform: true,
        publishingQuotaUsage: true,
        publishingQuotaTotal: true,
        publishingQuotaAt: true,
      },
    }),
    prisma.upload.findMany({
      where: {
        status: 'published',
        createdAt: { gte: since },
        socialAccount: where,
      },
      select: { socialAccountId: true, createdAt: true },
    }),
  ])

  const publishedByAccount = new Map<number, number>()
  for (const upload of uploads) {
    publishedByAccount.set(
      upload.socialAccountId,
      (publishedByAccount.get(upload.socialAccountId) ?? 0) + 1,
    )
  }

  const rows: AccountCapacityRow[] = accounts.map((account) => {
    const stale = isLimitStale(account.publishingQuotaAt, now.getTime())
    const known = account.publishingQuotaUsage !== null && account.publishingQuotaTotal !== null
    return {
      id: account.id,
      displayName: account.displayName,
      platform: account.platform,
      quotaUsage: account.publishingQuotaUsage,
      quotaTotal: account.publishingQuotaTotal,
      quotaCheckedAt: account.publishingQuotaAt?.toISOString() ?? null,
      quotaStale: stale,
      publishedLast24h: publishedByAccount.get(account.id) ?? 0,
      free: known && !stale
        ? Math.max(0, account.publishingQuotaTotal! - account.publishingQuotaUsage!)
        : null,
    }
  })

  const fresh = rows.filter(row => row.free !== null)
  const totalFree = fresh.length > 0 ? fresh.reduce((sum, row) => sum + (row.free ?? 0), 0) : null

  // Прогноз: публикация, сделанная в T, освобождает слот в T + 24 часа.
  const buckets = new Map<number, number>()
  const currentHour = new Date(now)
  currentHour.setMinutes(0, 0, 0)
  for (let index = 0; index < 24; index += 1) {
    buckets.set(currentHour.getTime() + index * HOUR_MS, 0)
  }
  for (const upload of uploads) {
    const releaseAt = upload.createdAt.getTime() + DAY_MS
    const bucket = new Date(releaseAt)
    bucket.setMinutes(0, 0, 0)
    const key = bucket.getTime()
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  const recovery: CapacityRecoveryPoint[] = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, recovered]) => ({ hour: new Date(hour).toISOString(), recovered }))

  const lastWithRecovery = [...recovery].reverse().find(point => point.recovered > 0) ?? null

  return {
    accounts: rows,
    totalFree,
    accountsWithoutLimit: rows.length - fresh.length,
    recovery,
    fullyRecoveredAt: lastWithRecovery?.hour ?? null,
  }
}
