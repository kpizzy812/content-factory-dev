/**
 * Production-grade Pipeline Scheduler Plugin.
 *
 * Features:
 * - 60-second tick interval
 * - Timezone-aware cron matching
 * - Misfire handling (records missed runs)
 * - Stuck run detection (watchdog)
 * - Duplicate run prevention
 * - Last run status tracking
 * - Batch limit (20 per tick)
 */

export default defineNitroPlugin((nitro) => {
  // Гейт scheduler'ов (тестовая инфраструктура). См. .env.test.
  if (process.env.SCHEDULERS_ENABLED === "false") return

  const TICK_INTERVAL = 60_000
  const MAX_SCHEDULES_PER_TICK = 20

  // Start runtime governor queue polling and recovery
  const stopQueuePolling = startQueuePolling()

  // Recovery on startup — handle orphaned runs from previous process
  recoverOrphanedRuns()
    .then((count) => {
      if (count > 0) {
        logAgent('pipeline-scheduler', 'info', `Recovery: обработано ${count} сиротских запусков`)
      }
    })
    .catch(() => {})

  const timer = trackedInterval('pipeline-schedules', 'Расписания конвейеров', TICK_INTERVAL, async () => {
    try {
      const now = new Date()

      // 1. Find due schedules
      const dueSchedules = await prisma.pipelineSchedule.findMany({
        where: {
          enabled: true,
          nextRunAt: { lte: now },
        },
        include: {
          pipeline: { select: { id: true, status: true, graphData: true } },
        },
        take: MAX_SCHEDULES_PER_TICK,
        orderBy: { nextRunAt: 'asc' },
      })

      for (const schedule of dueSchedules) {
        // Skip inactive pipelines
        if (schedule.pipeline.status !== 'active') {
          // Track misfire
          await prisma.pipelineSchedule.update({
            where: { id: schedule.id },
            data: {
              nextRunAt: getNextRunTime(schedule.cronExpr, now),
              lastRunStatus: 'skipped_inactive',
              missedRunCount: { increment: 1 },
            },
          }).catch(() => {})
          continue
        }

        const graph = schedule.pipeline.graphData as { nodes?: unknown[] }
        if (!Array.isArray(graph?.nodes) || graph.nodes.length === 0) {
          await prisma.pipelineSchedule.update({
            where: { id: schedule.id },
            data: {
              nextRunAt: getNextRunTime(schedule.cronExpr, now),
              lastRunStatus: 'skipped_empty',
              missedRunCount: { increment: 1 },
            },
          }).catch(() => {})
          continue
        }

        // Duplicate run prevention
        const activeRun = await prisma.workflowRun.findFirst({
          where: {
            pipelineId: schedule.pipelineId,
            status: { in: ['running', 'pending'] },
          },
        })

        if (activeRun) {
          await prisma.pipelineSchedule.update({
            where: { id: schedule.id },
            data: {
              nextRunAt: getNextRunTime(schedule.cronExpr, now),
              lastRunStatus: 'skipped_already_running',
              missedRunCount: { increment: 1 },
            },
          }).catch(() => {})
          continue
        }

        try {
          const run = await prisma.workflowRun.create({
            data: {
              pipelineId: schedule.pipelineId,
              triggerType: 'schedule',
              status: 'pending',
            },
          })

          enqueueRun(run.id).catch(() => {})

          const nextRunAt = getNextRunTime(schedule.cronExpr, now)

          await prisma.pipelineSchedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt,
              lastRunStatus: 'triggered',
              missedRunCount: 0,
            },
          })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Ошибка запуска'
          await prisma.pipelineSchedule.update({
            where: { id: schedule.id },
            data: {
              nextRunAt: getNextRunTime(schedule.cronExpr, now),
              lastRunStatus: `error: ${message.slice(0, 200)}`,
            },
          }).catch(() => {})
          await logAgent('pipeline-scheduler', 'error', `Ошибка запуска по расписанию #${schedule.pipelineId}: ${message}`).catch(() => {})
        }
      }

      // 2. Stuck run detection (every tick)
      await detectStuckRuns().catch(() => {})
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
      await logAgent('pipeline-scheduler', 'error', `Pipeline scheduler: ${message}`).catch(() => {})
    }
  })

  nitro.hooks.hook('close', () => {
    clearInterval(timer)
    stopQueuePolling()
  })
})
