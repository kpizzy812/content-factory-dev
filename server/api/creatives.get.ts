/**
 * GET /api/creatives
 * Объединённый запрос трендов, сценариев и видео.
 * Query: type (trend/scenario/video/all), status, appId, page, perPage
 */

interface CreativeItem {
  type: 'trend' | 'scenario' | 'video'
  id: number
  title: string
  status: string
  platform: string | null
  createdAt: string
  appName: string | null
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'trendwatcher' })

  const query = getQuery(event)
  const type = (query.type as string) || 'all'
  const status = query.status as string | undefined
  const appId = query.appId ? Number(query.appId) : undefined
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))

  const includeTrends = type === 'all' || type === 'trend'
  const includeScenarios = type === 'all' || type === 'scenario'
  const includeVideos = type === 'all' || type === 'video'

  const [trends, scenarios, videos] = await Promise.all([
    includeTrends
      ? prisma.trend.findMany({
          where: {
            ...(appId ? { appId } : {}),
            ...(status ? { status: status as any } : {}),
          },
          select: {
            id: true, title: true, status: true, platform: true, createdAt: true,
            app: { select: { name: true } },
          },
        })
      : [],
    includeScenarios
      ? prisma.scenario.findMany({
          where: {
            ...(appId ? { trend: { appId } } : {}),
            ...(status ? { status: status as any } : {}),
          },
          select: {
            id: true, status: true, createdAt: true,
            trend: { select: { title: true, platform: true, app: { select: { name: true } } } },
          },
        })
      : [],
    includeVideos
      ? prisma.video.findMany({
          where: {
            ...(appId ? { scenario: { trend: { appId } } } : {}),
            ...(status ? { status: status as any } : {}),
          },
          select: {
            id: true, status: true, createdAt: true,
            scenario: {
              select: {
                trend: { select: { title: true, platform: true, app: { select: { name: true } } } },
              },
            },
          },
        })
      : [],
  ])

  // Объединение в единый массив
  const items: CreativeItem[] = []

  for (const t of trends) {
    items.push({
      type: 'trend', id: t.id, title: t.title, status: t.status,
      platform: t.platform, createdAt: t.createdAt.toISOString(),
      appName: t.app?.name ?? null,
    })
  }

  for (const s of scenarios) {
    items.push({
      type: 'scenario', id: s.id, title: s.trend?.title ?? 'Сценарий',
      status: s.status, platform: s.trend?.platform ?? null,
      createdAt: s.createdAt.toISOString(),
      appName: s.trend?.app?.name ?? null,
    })
  }

  for (const v of videos) {
    items.push({
      type: 'video', id: v.id, title: v.scenario?.trend?.title ?? 'Видео',
      status: v.status, platform: v.scenario?.trend?.platform ?? null,
      createdAt: v.createdAt.toISOString(),
      appName: v.scenario?.trend?.app?.name ?? null,
    })
  }

  // Сортировка по дате desc
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  // Пагинация
  const total = items.length
  const paginated = items.slice((page - 1) * perPage, page * perPage)

  return {
    data: paginated,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  }
})
