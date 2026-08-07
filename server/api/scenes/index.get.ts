/**
 * GET /api/scenes?appId=N&search=&status=&archived=0|1
 * Список сцен приложения.
 */
import type { SceneStatus } from "~~/shared/types/scene"

const STATUSES: SceneStatus[] = ["draft", "ready", "generating", "done"]

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
  const status = typeof query.status === "string" && STATUSES.includes(query.status as SceneStatus)
    ? (query.status as SceneStatus)
    : null
  const showArchived = query.archived === "1" || query.archived === "true"

  const where = {
    appId,
    ...(showArchived ? {} : { archived: false }),
    ...(status ? { status } : {}),
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

  // Пагинация — только по явной просьбе: тот же список читает композитор,
  // и обрезать его двадцатью строками значит спрятать сцены от оператора.
  const wantsPages = query.page !== undefined || query.perPage !== undefined
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 24))

  const total = await prisma.scene.count({ where })

  const scenes = await prisma.scene.findMany({
    where,
    ...(wantsPages ? { skip: (page - 1) * perPage, take: perPage } : {}),
    orderBy: [{ archived: "asc" }, { updatedAt: "desc" }],
  })

  return {
    data: scenes,
    meta: {
      total,
      page: wantsPages ? page : 1,
      perPage: wantsPages ? perPage : total,
      totalPages: wantsPages ? Math.max(1, Math.ceil(total / perPage)) : 1,
    },
  }
})
