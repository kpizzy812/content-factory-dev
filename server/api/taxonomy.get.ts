/**
 * GET /api/taxonomy
 *
 * Список taxonomy items с фильтрацией и поиском.
 * Query params: type, category, search, includeArchived, page, perPage
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 50))
  const skip = (page - 1) * perPage

  const where: Record<string, unknown> = {}

  // Фильтр по типу
  if (query.type && typeof query.type === 'string') {
    where.type = query.type
  }

  // Фильтр по категории
  if (query.category && typeof query.category === 'string') {
    where.category = query.category
  }

  // По умолчанию скрываем архивные
  if (query.includeArchived !== 'true') {
    where.isArchived = false
  }

  // Текстовый поиск
  if (query.search && typeof query.search === 'string') {
    const search = query.search.trim()
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { shortDescription: { contains: search, mode: 'insensitive' } },
        { tags: { hasSome: [search.toLowerCase()] } },
      ]
    }
  }

  const [items, total] = await Promise.all([
    prisma.taxonomyItem.findMany({
      where,
      skip,
      take: perPage,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    }),
    prisma.taxonomyItem.count({ where }),
  ])

  // Собираем уникальные категории для фильтров
  const categories = query.type
    ? await prisma.taxonomyItem.findMany({
        where: { type: query.type as any, isArchived: false },
        select: { category: true },
        distinct: ['category'],
      }).then(rows => rows.map(r => r.category).filter(Boolean))
    : []

  return {
    data: items,
    meta: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      categories,
    },
  }
})
