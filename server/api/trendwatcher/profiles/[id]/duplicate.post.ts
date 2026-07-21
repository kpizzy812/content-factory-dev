/**
 * POST /api/trendwatcher/profiles/:id/duplicate
 * Дублирование профиля Trendwatcher.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "trendwatcher",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id профиля" })
  }

  const original = await prisma.trendwatcherProfile.findUnique({
    where: { id },
  })

  if (!original) {
    throw createError({ statusCode: 404, message: "Профиль не найден" })
  }

  const duplicate = await prisma.trendwatcherProfile.create({
    data: {
      appId: original.appId,
      name: `${original.name} (копия)`,
      actorId: original.actorId,
      keywords: original.keywords,
      platforms: original.platforms,
      language: original.language,
      geo: original.geo,
      viewCountMin: original.viewCountMin,
      viewCountMax: original.viewCountMax,
      maxItems: original.maxItems,
      enabled: false, // Копия создаётся выключенной
    },
    include: { app: { select: { id: true, name: true } } },
  })

  return { data: duplicate }
})
