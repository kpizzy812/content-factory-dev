/**
 * GET /api/posting-jobs/stats
 *
 * Aggregate-статистика PostingJob:
 *   - byStatus: { [status]: count }
 *   - byPlatform: { [platform]: count }
 *   - topAccounts: top-10 аккаунтов по количеству jobs (любого статуса)
 */
import type { Platform, PostingJobStatus } from "~~/app/generated/prisma/client"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const [byStatusRaw, byPlatformRaw, topAccountsRaw] = await Promise.all([
    prisma.postingJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.postingJob.groupBy({
      by: ["platform"],
      _count: { _all: true },
    }),
    prisma.postingJob.groupBy({
      by: ["socialAccountId"],
      _count: { _all: true },
      orderBy: { _count: { socialAccountId: "desc" } },
      take: 10,
    }),
  ])

  const byStatus: Record<PostingJobStatus, number> = {
    scheduled: 0,
    queued: 0,
    preparing: 0,
    uploading: 0,
    published: 0,
    failed: 0,
    retry_queued: 0,
    cancelled: 0,
  }
  for (const row of byStatusRaw) {
    byStatus[row.status] = row._count._all
  }

  const byPlatform: Record<Platform, number> = {
    tiktok: 0,
    instagram: 0,
    youtube: 0,
  }
  for (const row of byPlatformRaw) {
    byPlatform[row.platform] = row._count._all
  }

  // Подтягиваем displayName для top-аккаунтов одним запросом
  const accountIds = topAccountsRaw.map((r) => r.socialAccountId)
  const accounts =
    accountIds.length > 0
      ? await prisma.socialAccount.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, displayName: true, platform: true, status: true },
        })
      : []
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const topAccounts = topAccountsRaw.map((row) => {
    const a = accountById.get(row.socialAccountId)
    return {
      socialAccountId: row.socialAccountId,
      count: row._count._all,
      displayName: a?.displayName ?? `#${row.socialAccountId}`,
      platform: a?.platform ?? null,
      status: a?.status ?? null,
    }
  })

  return {
    data: {
      byStatus,
      byPlatform,
      topAccounts,
    },
  }
})
