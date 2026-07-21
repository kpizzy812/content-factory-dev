/**
 * GET /api/admin/dashboard
 * Агрегированные данные для панели администратора.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [
    recentCycles,
    videosToday,
    videosWeek,
    unresolvedErrors,
    runningCycle,
    failedCycle,
    trendsTotal,
    trendsNew,
    scenariosAwaitingReview,
    ideasReady,
    videosGenerating,
    pendingUploads,
    recentErrors,
    telegramStatus,
  ] = await Promise.all([
    prisma.productionCycle.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { app: { select: { id: true, name: true } } },
    }),
    prisma.upload.count({
      where: { status: "published", createdAt: { gte: oneDayAgo } },
    }),
    prisma.upload.count({
      where: { status: "published", createdAt: { gte: oneWeekAgo } },
    }),
    prisma.agentLog.count({
      where: { level: "error", resolved: false },
    }),
    prisma.productionCycle.findFirst({
      where: { status: "running" },
    }),
    prisma.productionCycle.findFirst({
      where: { status: "failed" },
      orderBy: { createdAt: "desc" },
    }),
    // Content pipeline stats
    prisma.trend.count({
      where: { isDeleted: false },
    }),
    prisma.trend.count({
      where: { isDeleted: false, status: "new" },
    }),
    prisma.scenario.count({
      where: { isDeleted: false, status: { in: ["generated", "draft"] } },
    }),
    prisma.idea.count({
      where: { isDeleted: false, status: "ready" },
    }),
    prisma.video.count({
      where: { status: { in: ["pending", "generating_images", "generating_clips", "assembling"] } },
    }),
    prisma.upload.count({
      where: { status: "pending" },
    }),
    // Recent errors for quick access
    prisma.agentLog.findMany({
      where: { level: "error", resolved: false },
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, module: true, message: true, cycleId: true, createdAt: true },
    }),
    // Telegram status
    prisma.telegramChat.count({
      where: { alertsEnabled: true },
    }),
  ])

  let status: "working" | "idle" | "error" = "idle"
  if (runningCycle) status = "working"
  else if (failedCycle) status = "error"

  return {
    data: {
      status,
      recentCycles,
      videosToday,
      videosWeek,
      unresolvedErrors,
      // Content pipeline
      contentPipeline: {
        trendsTotal,
        trendsNew,
        scenariosAwaitingReview,
        ideasReady,
        videosGenerating,
        pendingUploads,
      },
      recentErrors,
      telegramAlertChats: telegramStatus,
    },
  }
})
