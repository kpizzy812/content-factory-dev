import { abortRun } from '../../../../utils/pipeline-cancel-registry'

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, message: 'Invalid batch ID' })

  const cycle = await prisma.productionCycle.findUnique({
    where: { id },
    include: { pipeline: { select: { userId: true, sharedWith: true } } },
  })
  if (!cycle || cycle.mode !== 'pipeline_batch') throw createError({ statusCode: 404, message: 'Batch not found' })
  const canCancel = user.canAdmin || cycle.startedById === user.id || cycle.pipeline?.userId === user.id || cycle.pipeline?.sharedWith.includes(user.id)
  if (!canCancel) throw createError({ statusCode: 403, message: 'No access to cancel this batch' })

  if (cycle.status === 'stopped') {
    return { data: cycle, cancelledRuns: 0, signalledRuns: 0, reused: true }
  }

  const activeRuns = await prisma.workflowRun.findMany({
    where: { cycleId: id, status: { in: ['pending', 'running'] } },
    select: { id: true, status: true },
  })

  const now = new Date()
  const reason = `Factory batch #${id} was cancelled`
  const result = await prisma.$transaction(async (tx) => {
    const pending = await tx.workflowRun.updateMany({
      where: { cycleId: id, status: 'pending' },
      data: {
        status: 'cancelled',
        cancelRequestedAt: now,
        cancelRequestedBy: user.id,
        finishedAt: now,
        errorMessage: reason,
        errorCategory: 'cancellation',
      },
    })
    const running = await tx.workflowRun.updateMany({
      where: { cycleId: id, status: 'running', cancelRequestedAt: null },
      data: { cancelRequestedAt: now, cancelRequestedBy: user.id },
    })
    await tx.factoryPublication.updateMany({
      where: { cycleId: id, status: 'planned' },
      data: { status: 'cancelled' },
    })
    const updatedCycle = await tx.productionCycle.update({
      where: { id },
      data: { status: 'stopped', completedAt: now, errorMessage: reason },
    })
    return { pending: pending.count, running: running.count, cycle: updatedCycle }
  })

  let signalledRuns = 0
  for (const run of activeRuns) {
    if (run.status === 'running' && abortRun(run.id)) signalledRuns++
  }

  return {
    data: result.cycle,
    cancelledRuns: result.pending,
    signalledRuns,
    runningRunsMarkedForCancellation: result.running,
    reused: false,
  }
})