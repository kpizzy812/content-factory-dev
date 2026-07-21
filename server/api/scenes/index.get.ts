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

  const scenes = await prisma.scene.findMany({
    where,
    orderBy: [{ archived: "asc" }, { updatedAt: "desc" }],
  })

  return { data: scenes }
})
