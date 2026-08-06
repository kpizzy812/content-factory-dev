/**
 * GET /api/admin/system-health — что работает прямо сейчас.
 *
 * До него панель «здоровье системы» в админке показывала только очередь
 * запусков. Самая частая авария завода выглядит иначе: планировщик тихо
 * перестал тикать, и очередь просто не разбирается — а по интерфейсу это
 * неотличимо от «нечего делать».
 *
 * Проверок наружу здесь нет: они дороже и живут в `/api/admin/integrations`.
 */

import { getSchedulerStats } from '~~/server/utils/scheduler-registry'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'canAdmin')

  const runtime = getRuntimeStats()
  const [queuedRuns, activeRuns] = await Promise.all([
    prisma.workflowRun.count({ where: { status: 'pending', cancelRequestedAt: null } }),
    prisma.workflowRun.count({ where: { status: 'running' } }),
  ])

  return {
    data: {
      // «Воркеры 3 из 4» из макета: сколько мест исполнителя занято.
      workers: {
        busy: runtime.activeRuns,
        capacity: runtime.maxConcurrent,
        // Запусков в статусе running может быть больше, чем занятых мест,
        // если процесс перезапускали: такие подберёт recovery.
        runningInDb: activeRuns,
        queuedRuns,
        instanceId: runtime.instanceId,
        runtimeMode: runtime.runtimeMode,
        uptimeMs: runtime.uptimeMs,
      },
      schedulers: getSchedulerStats(),
      checkedAt: new Date().toISOString(),
    },
  }
})
