/**
 * GET /api/scenarios/profiles
 * Список профилей генерации сценариев с опциональным фильтром по appId.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'script-generator',
  })

  const query = getQuery(event)
  const appId = query.appId ? Number(query.appId) : undefined

  const where: Record<string, unknown> = {}
  if (appId && !Number.isNaN(appId)) {
    where.appId = appId
  }

  const profiles = await prisma.scenarioGenerationProfile.findMany({
    where,
    include: {
      app: { select: { id: true, name: true } },
      _count: { select: { scenarios: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return { data: profiles }
})
