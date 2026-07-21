/**
 * DELETE /api/trendwatcher/profiles/:id
 * Удаление профиля парсинга.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "trendwatcher",
  })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Некорректный ID профиля",
    })
  }

  const existing = await prisma.trendwatcherProfile.findUnique({ where: { id } })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: "Профиль парсинга не найден",
    })
  }

  await prisma.trendwatcherProfile.delete({ where: { id } })

  return { data: { id }, meta: { deleted: true } }
})
