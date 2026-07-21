/**
 * Manual pipeline run trigger.
 *
 * Production features:
 * - Pre-run validation
 * - Graph snapshot on run
 * - Duplicate run prevention
 * - Access control (owner/shared/admin)
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID конвейера' })
  }

  const pipeline = await prisma.pipeline.findUnique({
    where: { id },
  })

  if (!pipeline) {
    throw createError({ statusCode: 404, message: 'Конвейер не найден' })
  }

  // Access check
  const isOwner = pipeline.userId === user.id
  const isShared = pipeline.sharedWith.includes(user.id)
  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Нет доступа к этому конвейеру' })
  }

  if (pipeline.status !== 'active') {
    throw createError({ statusCode: 400, message: 'Конвейер не активен. Активируйте перед запуском.' })
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

  const graph = pipeline.graphData as { nodes?: unknown[]; edges?: unknown[] }
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []

  if (nodes.length === 0) {
    throw createError({ statusCode: 400, message: 'Конвейер не содержит нод. Добавьте хотя бы один блок.' })
  }

  // Quick validation
  const validation = await validatePipeline(id)
  if (!validation.ready) {
    const errors = validation.issues.filter(i => i.severity === 'error')
    throw createError({
      statusCode: 400,
      message: `Конвейер не прошёл валидацию: ${errors.map(e => e.message).join('; ')}`,
    })
  }

  // Create WorkflowRun with graph snapshot
  const run = await prisma.workflowRun.create({
    data: {
      pipelineId: id,
      triggeredBy: user.id,
      triggerType: 'manual',
      status: 'pending',
      graphSnapshot: pipeline.graphData as never,
    },
  })

  // Enqueue with bounded concurrency
  const queueResult = await enqueueRun(run.id)

  return {
    data: {
      runId: run.id,
      status: 'pending',
      queueStatus: queueResult,
    },
  }
})
