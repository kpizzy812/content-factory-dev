export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })
  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const appId = Number(query.appId) || undefined

  const where = {
    mode: 'pipeline_batch',
    ...(appId ? { appId } : {}),
    ...(!user.canAdmin ? { startedById: user.id } : {}),
  }
  const [items, total] = await Promise.all([
    prisma.productionCycle.findMany({
      where,
      include: {
        pipeline: { select: { id: true, name: true } },
        app: { select: { id: true, name: true } },
        funnel: { select: { id: true, name: true, keyword: true } },
        _count: { select: { runs: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.productionCycle.count({ where }),
  ])

  return {
    data: items,
    meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  }
})
