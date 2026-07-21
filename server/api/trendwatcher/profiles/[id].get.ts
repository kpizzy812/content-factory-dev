/**
 * GET /api/trendwatcher/profiles/:id
 * Один профиль по id — для pipeline node summary и edit flow.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "trendwatcher",
  })

  const id = Number(getRouterParam(event, "id"))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID профиля" })
  }

  const profile = await prisma.trendwatcherProfile.findUnique({
    where: { id },
    include: {
      app: { select: { id: true, name: true } },
      runs: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          foundCount: true,
          importedCount: true,
          failureReason: true,
          triggerType: true,
        },
      },
    },
  })

  if (!profile) {
    throw createError({ statusCode: 404, message: "Профиль не найден" })
  }

  const enriched = {
    ...profile,
    hasActiveRun: hasActiveRun(profile.id),
    activeRunId: getActiveRunId(profile.id) ?? null,
    lastRun: profile.runs[0] ?? null,
    runs: undefined,
  }

  return { data: enriched }
})
