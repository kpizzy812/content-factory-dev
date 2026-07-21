/**
 * GET /api/ideas/sync/status
 * Обзор состояния синхронизации идей с MarketingCamp.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'script-generator',
  })

  const [
    total,
    synced,
    imported,
    exported,
    conflicts,
    errors,
    pendingExport,
    lastSynced,
  ] = await Promise.all([
    prisma.idea.count({ where: { isDeleted: false } }),
    prisma.idea.count({ where: { isDeleted: false, syncStatus: 'synced' } }),
    prisma.idea.count({ where: { isDeleted: false, syncDirection: 'imported' } }),
    prisma.idea.count({ where: { isDeleted: false, syncDirection: 'exported' } }),
    prisma.idea.count({ where: { isDeleted: false, syncStatus: 'conflict' } }),
    prisma.idea.count({ where: { isDeleted: false, syncStatus: 'error' } }),
    prisma.idea.count({ where: { isDeleted: false, syncStatus: 'pending_export' } }),
    prisma.idea.findFirst({
      where: { isDeleted: false, lastSyncedAt: { not: null } },
      orderBy: { lastSyncedAt: 'desc' },
      select: { lastSyncedAt: true },
    }),
  ])

  const health = await checkMarketingCampHealth()

  return {
    data: {
      connection: {
        connected: health.connected,
        error: health.error ?? null,
      },
      counts: {
        total,
        synced,
        imported,
        exported,
        conflicts,
        errors,
        pendingExport,
        local: total - imported - exported,
      },
      lastSyncedAt: lastSynced?.lastSyncedAt?.toISOString() ?? null,
    },
  }
})
