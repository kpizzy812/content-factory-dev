export default defineEventHandler(async (event) => {
  await requirePermission(event, 'canRead')

  const [healthResult, syncCounts] = await Promise.all([
    checkMarketingCampHealth(),
    prisma.idea.groupBy({
      by: ['syncStatus'],
      where: { isDeleted: false },
      _count: true,
    }),
  ])

  const syncSummary: Record<string, number> = {}
  for (const row of syncCounts) {
    syncSummary[row.syncStatus] = row._count
  }

  return {
    data: {
      connected: healthResult.connected,
      lastChecked: new Date().toISOString(),
      ...(healthResult.error ? { error: healthResult.error } : {}),
      ideaSync: {
        synced: syncSummary.synced ?? 0,
        conflicts: syncSummary.conflict ?? 0,
        errors: syncSummary.error ?? 0,
        pendingExport: syncSummary.pending_export ?? 0,
        local: syncSummary.none ?? 0,
      },
    },
  }
})
