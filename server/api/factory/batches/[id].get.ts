export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, message: 'Некорректный ID партии' })

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 50))
  const cycle = await prisma.productionCycle.findUnique({
    where: { id },
    include: {
      pipeline: { select: { id: true, name: true, userId: true, sharedWith: true } },
      app: { select: { id: true, name: true } },
      funnel: { select: { id: true, name: true, keyword: true, leadMagnetId: true } },
      _count: { select: { runs: true } },
    },
  })
  if (!cycle || cycle.mode !== 'pipeline_batch') throw createError({ statusCode: 404, message: 'Партия не найдена' })
  const canRead = user.canAdmin || cycle.startedById === user.id || cycle.pipeline?.userId === user.id || cycle.pipeline?.sharedWith.includes(user.id)
  if (!canRead) throw createError({ statusCode: 403, message: 'Нет доступа к партии' })

  const [runs, total, runGroups, videos, publications, published, eventGroups, automationGroups] = await Promise.all([
    prisma.workflowRun.findMany({
      where: { cycleId: id },
      select: {
        id: true,
        status: true,
        trackingToken: true,
        inputContext: true,
        errorMessage: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        videos: { select: { id: true, status: true, fileUrl: true }, take: 1 },
        uploads: { select: { id: true, status: true, platformPostId: true, platformPostUrl: true } },

        factoryPublications: {
          select: {
            id: true,
            platform: true,
            status: true,
            keyword: true,
            platformPostId: true,
            platformPostUrl: true,
            automationStatus: true,
            automationExternalId: true,
            automationError: true,
            automationAttempts: true,
            automationStartedAt: true,
            automationSyncedAt: true,
            _count: { select: { events: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.workflowRun.count({ where: { cycleId: id } }),
    prisma.workflowRun.groupBy({ by: ['status'], where: { cycleId: id }, _count: { _all: true } }),
    prisma.video.count({ where: { run: { cycleId: id } } }),
    prisma.factoryPublication.count({ where: { cycleId: id } }),
    prisma.factoryPublication.count({ where: { cycleId: id, status: 'published' } }),
    prisma.attributionEvent.groupBy({ by: ['type'], where: { publication: { cycleId: id } }, _count: { _all: true } }),
    prisma.factoryPublication.groupBy({ by: ['automationStatus'], where: { cycleId: id }, _count: { _all: true } }),
  ])

  return {
    data: {
      ...cycle,
      stats: {
        runs: Object.fromEntries(runGroups.map(group => [group.status, group._count._all])),
        videos,
        publicationsQueued: publications,
        published,
        events: Object.fromEntries(eventGroups.map(group => [group.type, group._count._all])),
        automation: Object.fromEntries(automationGroups.map(group => [group.automationStatus, group._count._all])),
      },
      runs,
    },
    meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  }
})
