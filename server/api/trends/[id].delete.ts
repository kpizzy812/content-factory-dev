export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canDelete'], moduleSlug: 'trendwatcher' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Invalid trend ID",
    })
  }

  const existing = await prisma.trend.findUnique({ where: { id } })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: "Тренд не найден",
    })
  }

  if (existing.isDeleted) {
    throw createError({
      statusCode: 409,
      message: "Тренд уже удалён",
    })
  }

  const trend = await prisma.trend.update({
    where: { id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      status: "dismissed",
    },
  })

  return { data: { id: trend.id, isDeleted: true } }
})
