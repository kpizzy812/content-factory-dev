/**
 * Pipeline runtime stats — active runs, capacity, queue status, runtime mode.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const stats = getRuntimeStats()

  const queuedCount = await prisma.workflowRun.count({
    where: { status: 'pending', cancelRequestedAt: null },
  })

  return {
    data: {
      ...stats,
      queuedRuns: queuedCount,
      capacityUsed: `${stats.activeRuns}/${stats.maxConcurrent}`,
    },
  }
})
