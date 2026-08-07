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
