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

  const characters = await prisma.character.findMany({
    where,
    orderBy: [{ archived: "asc" }, { updatedAt: "desc" }],
    include: {
      referenceImages: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        take: 6,
      },
    },
  })

  return { data: characters }
})
