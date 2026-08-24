/**
 * GET /api/apps/:id/background-clips
 *
 * Список активных фонов библиотеки монтажа приложения (§9 «Библиотека фонов»).
 * Погашенные (`isActive: false`) не возвращаются — на них могут ссылаться
 * кадры уже собранных роликов, но заново предлагать оператору их не нужно.
 */
export default defineEventHandler(async (event) => {
  const appId = Number(getRouterParam(event, "id"))
  if (!Number.isInteger(appId) || appId <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id приложения" })
  }

  // Авторизация ПО `appId` ИЗ URL — до любого ветвления по существованию
  // приложения (Important 4 финального ревью): иначе разница 404 и 401/403
  // работает неавторизованным оракулом существования `App.id`. Тот же порядок,
  // что у соседнего DELETE, где эта аргументация расписана целиком.
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "video-generator",
    appId,
  })

  const app = await prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
  if (!app) throw createError({ statusCode: 404, message: "Приложение не найдено" })

  const clips = await prisma.backgroundClip.findMany({
    where: { appId, isActive: true },
    orderBy: [{ usageCount: "asc" }, { createdAt: "desc" }],
  })

  return { data: clips }
})
