/**
 * GET /api/trendwatcher/profiles
 * Список профилей парсинга с фильтром по appId.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "trendwatcher",
  })

  const query = getQuery(event)
  const appId = query.appId ? Number(query.appId) : undefined
  const includeInline = query.includeInline === "1" || query.includeInline === "true"

  const where: Record<string, unknown> = {}
  if (appId && !Number.isNaN(appId)) {
    where.appId = appId
  }
  if (!includeInline) {
    where.isInline = false
  }

  const profiles = await prisma.trendwatcherProfile.findMany({
    where,
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
    orderBy: { createdAt: "desc" },
  })

  // Добавляем информацию о текущем активном запуске (in-memory)
  const enriched = profiles.map((p) => ({
    ...p,
    hasActiveRun: hasActiveRun(p.id),
    activeRunId: getActiveRunId(p.id) ?? null,
    lastRun: p.runs[0] ?? null,
    runs: undefined, // Убираем массив runs — заменяем на lastRun
  }))

  return { data: enriched }
})
