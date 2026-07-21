/**
 * GET /api/apps
 * Список приложений. ?fields=extended возвращает расширенный набор для scenario config.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'trendwatcher' })

  const query = getQuery(event)
  const extended = query.fields === 'extended'

  const apps = await prisma.app.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      ...(extended ? {
        description: true,
        subtitle: true,
        iconUrl: true,
        enrichmentStatus: true,
        brandTone: true,
        corePain: true,
        coreOutcome: true,
        transformationPromise: true,
      } : {}),
    },
  })

  return { data: apps }
})
