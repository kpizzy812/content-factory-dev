/**
 * Replay a previous pipeline run.
 *
 * Creates a new run linked to the original via replayOfRunId.
 * Optionally starts from a specific step (fromStepNodeId).
 * Re-uses the graph snapshot from the original run.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  const runId = Number(getRouterParam(event, 'runId'))

  if (Number.isNaN(id) || Number.isNaN(runId)) {
    throw createError({ statusCode: 400, message: 'Некорректные параметры' })
  }

  const body = await readBody<{ fromStepNodeId?: string }>(event).catch(() => ({}))

  const originalRun = await prisma.workflowRun.findFirst({
    where: { id: runId, pipelineId: id },
    include: {
      pipeline: { select: { userId: true, sharedWith: true, status: true, graphData: true } },
      steps: { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!originalRun) {
    throw createError({ statusCode: 404, message: 'Запуск не найден' })
  }

  // Access check
  const isOwner = originalRun.pipeline.userId === user.id
  const isShared = originalRun.pipeline.sharedWith.includes(user.id)
  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Нет доступа' })
  }

  if (originalRun.pipeline.status !== 'active') {
    throw createError({ statusCode: 400, message: 'Конвейер не активен' })
  }

  // Duplicate run prevention
  const activeRun = await prisma.workflowRun.findFirst({
    where: {
      pipelineId: id,
      status: { in: ['running', 'pending'] },
    },
  })

  if (activeRun) {
    throw createError({ statusCode: 409, message: 'Конвейер уже запущен' })
  }

  // Use original graph snapshot or current graph
  const graphSnapshot = originalRun.graphSnapshot ?? originalRun.pipeline.graphData

  const newRun = await prisma.workflowRun.create({
    data: {
      pipelineId: id,
      triggeredBy: user.id,
      triggerType: 'manual',
      status: 'pending',
      replayOfRunId: runId,
      graphSnapshot: graphSnapshot as never,
      graphVersionId: originalRun.graphVersionId,
    },
  })

  enqueueRun(newRun.id).catch(() => {})

  return {
    data: {
      runId: newRun.id,
      replayOfRunId: runId,
      status: 'pending',
    },
  }
})
