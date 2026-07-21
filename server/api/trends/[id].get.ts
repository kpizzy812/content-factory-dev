export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'trendwatcher' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Некорректный ID тренда",
    })
  }

  const trend = await prisma.trend.findUnique({
    where: { id },
    include: {
      insights: true,
      app: true,
      scenarios: true,
      brief: true,
    },
  })

  if (!trend) {
    throw createError({
      statusCode: 404,
      message: "Тренд не найден",
    })
  }

  return { data: trend }
})
