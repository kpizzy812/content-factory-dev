/**
 * GET /api/characters?appId=N&search=&archived=0|1
 * Список персонажей одного приложения с превью референсов (первые 4 картинки).
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appId = Number(query.appId)
  if (!appId || Number.isNaN(appId)) {
    throw createError({ statusCode: 400, message: "Параметр appId обязателен" })
  }

  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "script-generator",
    appId,
  })

  const search = typeof query.search === "string" ? query.search.trim() : ""
  const showArchived = query.archived === "1" || query.archived === "true"

  const where = {
    appId,
    ...(showArchived ? {} : { archived: false }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
            { tags: { has: search } },
          ],
        }
      : {}),
  }

  // Пагинация включается только тем, кто её попросил: список персонажей
  // читают ещё и пикеры сцен, и молча обрезать им выборку значит спрятать
  // половину персонажей от оператора.
  const wantsPages = query.page !== undefined || query.perPage !== undefined
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 24))

  const total = await prisma.character.count({ where })

  const characters = await prisma.character.findMany({
    where,
    ...(wantsPages ? { skip: (page - 1) * perPage, take: perPage } : {}),
    orderBy: [{ archived: "asc" }, { updatedAt: "desc" }],
    include: {
      referenceImages: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        take: 6,
      },
    },
  })

  return {
    data: characters,
    meta: {
      total,
      page: wantsPages ? page : 1,
      perPage: wantsPages ? perPage : total,
      totalPages: wantsPages ? Math.max(1, Math.ceil(total / perPage)) : 1,
    },
  }
})
