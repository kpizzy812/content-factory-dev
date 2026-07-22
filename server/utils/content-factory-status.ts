import { prisma } from './prisma'

const TERMINAL_RUN_STATUSES = ['success', 'failed', 'cancelled', 'no_data'] as const

/** Synchronises legacy ProductionCycle counters with its scalable Pipeline batch. */
export async function syncFactoryCycleStatus(cycleId: number): Promise<void> {
  const cycle = await prisma.productionCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, mode: true, status: true, targetCount: true },
  })
  if (!cycle || cycle.mode !== 'pipeline_batch' || cycle.status === 'stopped') return

  const [runGroups, trendsFound, scenariosGen, videosGen, apiUploads] = await Promise.all([
    prisma.workflowRun.groupBy({
      by: ['status'],
      where: { cycleId },
      _count: { _all: true },
    }),
    prisma.trend.count({ where: { run: { cycleId } } }),
    prisma.scenario.count({ where: { run: { cycleId } } }),
    prisma.video.count({ where: { run: { cycleId } } }),
    prisma.upload.count({ where: { run: { cycleId } } }),
  ])

  const counts = new Map(runGroups.map(group => [group.status, group._count._all]))
  const terminalCount = TERMINAL_RUN_STATUSES.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0)
  const failedCount = (counts.get('failed') ?? 0) + (counts.get('cancelled') ?? 0) + (counts.get('no_data') ?? 0)
  const allFinished = cycle.targetCount > 0 && terminalCount >= cycle.targetCount

  await prisma.productionCycle.update({
    where: { id: cycleId },
    data: {
      status: allFinished ? (counts.get('success') ? 'completed' : 'failed') : 'running',
      completedAt: allFinished ? new Date() : null,
      errorMessage: allFinished && failedCount > 0
        ? `${failedCount} из ${cycle.targetCount} запусков завершились без готового результата`
        : null,
      trendsFound,
      scenariosGen,
      videosGen,
      uploadsCount: apiUploads,
    },
  })
}
