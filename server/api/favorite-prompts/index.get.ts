/**
 * GET /api/favorite-prompts — список избранных промтов с фильтрами.
 * Возвращает:
 *   - все публичные (+ свои приватные)
 *   - с учётом RBAC: если у пользователя appAccess не пустой и он не admin —
 *     отдаются только записи с appId IN appAccess OR appId IS NULL (универсальные)
 */
import type { FavoritePromptListMeta } from '../../../shared/types/favorite-prompt'

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'script-generator',
  })

  const query = getQuery(event)

  // Быстрый lookup по sourceVideoAssetId (используется FavoritePromptButton для
  // проверки "уже в избранном"). При наличии — отдаём узкую выборку без пагинации.
  const sourceVideoAssetIdRaw = query.sourceVideoAssetId
  if (sourceVideoAssetIdRaw !== undefined && sourceVideoAssetIdRaw !== '') {
    const sourceVideoAssetId = Number(sourceVideoAssetIdRaw)
    if (Number.isFinite(sourceVideoAssetId) && sourceVideoAssetId > 0) {
      const match = await prisma.favoritePrompt.findFirst({
        where: { userId: user.id, sourceVideoAssetId },
        include: {
          app: { select: { id: true, name: true } },
          sourceVideoAsset: {
            select: {
              id: true,
              order: true,
              video: { select: { id: true, scenarioId: true } },
            },
          },
        },
      })
      const meta: FavoritePromptListMeta = {
        total: match ? 1 : 0,
        page: 1,
        perPage: 1,
        totalPages: match ? 1 : 0,
      }
      return { data: match ? [match] : [], meta }
    }
  }

  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage

  // appId фильтр:
  //   'all' или отсутствует → без ограничения
  //   'null' → только универсальные (appId IS NULL)
  //   число → конкретное приложение
  const appIdRaw = query.appId
  let appIdFilter: number | 'null' | null = null
  if (appIdRaw !== undefined && appIdRaw !== '' && appIdRaw !== 'all') {
    if (appIdRaw === 'null') {
      appIdFilter = 'null'
    } else {
      const n = Number(appIdRaw)
      if (Number.isFinite(n) && n > 0) appIdFilter = n
    }
  }

  // Теги: CSV → массив; ищем записи, у которых tags пересекается с заданным списком.
  const tagsRaw = typeof query.tags === 'string' ? query.tags : ''
  const tags = tagsRaw
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)

  // Поиск по promptText+notes (ILIKE case-insensitive через mode:'insensitive')
  const searchRaw = typeof query.search === 'string' ? query.search.trim() : ''

  const where: Record<string, unknown> = {}

  // Видимость: публичные всем + свои (включая приватные)
  where.OR = [
    { isPublic: true },
    { userId: user.id },
  ]

  // RBAC-фильтр по appAssignments (admin видит все, не-admin — только назначенные с
  // accessLevel != 'none', плюс универсальные записи где appId IS NULL).
  const appAccessConditions: unknown[] = []
  if (!user.canAdmin) {
    const accessibleAppIds = user.appAssignments
      .filter((a) => a.accessLevel !== "none")
      .map((a) => a.appId)
    if (accessibleAppIds.length > 0) {
      appAccessConditions.push({ appId: { in: accessibleAppIds } })
      appAccessConditions.push({ appId: null })
    } else {
      // Нет назначенных приложений — видны только универсальные (appId IS NULL).
      appAccessConditions.push({ appId: null })
    }
  }

  if (appIdFilter === 'null') {
    where.appId = null
  } else if (typeof appIdFilter === 'number') {
    where.appId = appIdFilter
  }

  if (tags.length > 0) {
    where.tags = { hasSome: tags }
  }

  if (searchRaw.length > 0) {
    where.AND = [
      {
        OR: [
          { promptText: { contains: searchRaw, mode: 'insensitive' } },
          { notes: { contains: searchRaw, mode: 'insensitive' } },
        ],
      },
    ]
  }

  // Объединяем appAccess-ограничение как AND-условие (если задано)
  if (appAccessConditions.length > 0) {
    const existingAnd = (where.AND as unknown[] | undefined) ?? []
    where.AND = [...existingAnd, { OR: appAccessConditions }]
  }

  const [items, total] = await Promise.all([
    prisma.favoritePrompt.findMany({
      where,
      orderBy: [
        { usageCount: 'desc' },
        { createdAt: 'desc' },
      ],
      skip,
      take: perPage,
      include: {
        app: { select: { id: true, name: true } },
        sourceVideoAsset: {
          select: {
            id: true,
            order: true,
            video: { select: { id: true, scenarioId: true } },
          },
        },
      },
    }),
    prisma.favoritePrompt.count({ where }),
  ])

  const meta: FavoritePromptListMeta = {
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage) || 1,
  }

  return { data: items, meta }
})
