/**
 * GET /api/trendwatcher/runs
 * Список запусков Trendwatcher с фильтрацией по profileId и статусу.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "trendwatcher",
  })

  const query = getQuery(event)
  const profileId = query.profileId ? Number(query.profileId) : undefined
  const status = query.status as string | undefined
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(50, Math.max(1, Number(query.perPage) || 20))

  const where: Record<string, unknown> = {}
  if (profileId) where.profileId = profileId
  if (status) where.status = status

  const [runs, total] = await Promise.all([
    prisma.trendwatcherRun.findMany({
      where,
      include: {
        profile: { select: { id: true, name: true, actorId: true } },
        _count: { select: { logs: true } },
      },
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.trendwatcherRun.count({ where }),
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
