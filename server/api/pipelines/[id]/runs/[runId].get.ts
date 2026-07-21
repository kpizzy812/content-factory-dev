export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  const runId = Number(getRouterParam(event, 'runId'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID конвейера',
    })
  }

  if (Number.isNaN(runId) || runId <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID запуска',
    })
  }

  const pipeline = await prisma.pipeline.findUnique({
    where: { id },
  })

  if (!pipeline) {
    throw createError({
      statusCode: 404,
      message: 'Конвейер не найден',
    })
  }

  // Проверка доступа: владелец, расшарен или admin
  const isOwner = pipeline.userId === user.id
  const isShared = pipeline.sharedWith.includes(user.id)

  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Нет доступа к этому конвейеру',
    })
  }

  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: {
      steps: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!run || run.pipelineId !== id) {
    throw createError({
      statusCode: 404,
      message: 'Запуск не найден',
    })
  }

  return { data: run }
})
