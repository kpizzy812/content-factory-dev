/**
 * GET /api/trendwatcher/runs/:id
 * Детальная информация о запуске: статус, статистика, логи.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "trendwatcher",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id запуска" })
  }

  const run = await prisma.trendwatcherRun.findUnique({
    where: { id },
    include: {
      profile: { select: { id: true, name: true, actorId: true, appId: true } },
      logs: {
        orderBy: { createdAt: "asc" },
        take: 500,
      },
    },
  })

  if (!run) {
    throw createError({ statusCode: 404, message: "Запуск не найден" })
  }

  return { data: run }
})
