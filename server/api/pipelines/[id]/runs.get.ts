export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID конвейера',
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

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(50, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage

  // Фильтр по статусу (опциональный query-параметр)
  const validStatuses = ['pending', 'running', 'success', 'failed', 'cancelled']
  const statusFilter = typeof query.status === 'string' && validStatuses.includes(query.status)
    ? query.status as 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
    : undefined

  const where = {
    pipelineId: id,
    ...(statusFilter ? { status: statusFilter } : {}),
  }

  const [runs, total] = await Promise.all([
    prisma.workflowRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: perPage,
      include: {
        _count: { select: { steps: true } },
      },
    }),
    prisma.workflowRun.count({ where }),
  ])

  return {
    data: runs,
    meta: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    },
  }
})
