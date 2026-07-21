import type { TrendStatsResponse } from "../../../shared/types/trend"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'trendwatcher' })

  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const activeFilter = { isDeleted: false }

  const [total, byStatusRaw, byPlatformRaw, recentCount] = await Promise.all([
    prisma.trend.count({ where: activeFilter }),

    prisma.trend.groupBy({
      by: ["status"],
      where: activeFilter,
      _count: { status: true },
    }),

    prisma.trend.groupBy({
      by: ["platform"],
      where: activeFilter,
      _count: { platform: true },
    }),

    prisma.trend.count({
      where: { ...activeFilter, importedAt: { gte: oneDayAgo } },
    }),
  ])

  const byStatus: Record<string, number> = {}
  for (const row of byStatusRaw) {
    byStatus[row.status] = row._count.status
  }

  const byPlatform: Record<string, number> = {}
  for (const row of byPlatformRaw) {
    byPlatform[row.platform] = row._count.platform
  }

  const data: TrendStatsResponse = {
    total,
    byStatus,
    byPlatform,
    recentCount,
  }

  return { data }
})
