import type { DashboardData, UploadWithMetrics } from "../../../shared/types/analytics"

/**
 * GET /api/analytics/dashboard
 * Сводные карточки: totalViews, totalFollowerGain, avgWatchThrough,
 * bestPost + topCtrPosts(5).
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'analytics' })

  const query = getQuery(event)

  // Фильтры по периоду
  const dateFrom = query.dateFrom ? new Date(String(query.dateFrom)) : undefined
  const dateTo = query.dateTo ? new Date(String(query.dateTo)) : undefined
  const appId = query.appId ? Number(query.appId) : undefined

  // --- Pipeline/run filter: фильтрация "К юниту" из монитора исполнений ---
  const runIdRaw = Number(query.runId)
  const runIdFilter = Number.isFinite(runIdRaw) && runIdRaw > 0 ? runIdRaw : undefined
  const pipelineIdRaw = Number(query.pipelineId)
  const pipelineIdFilter = Number.isFinite(pipelineIdRaw) && pipelineIdRaw > 0 ? pipelineIdRaw : undefined

  // Находим все опубликованные загрузки с последними метриками
  const uploads = await prisma.upload.findMany({
    where: {
      status: "published",
      ...(appId ? { socialAccount: { appId } } : {}),
      ...(runIdFilter ? { runId: runIdFilter } : {}),
      ...(pipelineIdFilter ? { pipelineId: pipelineIdFilter } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    },
    include: {
      socialAccount: {
        select: { id: true, platform: true, displayName: true },
      },
      video: {
        select: { id: true, fileUrl: true, duration: true },
      },
      metrics: {
        orderBy: { collectedAt: "desc" },
        take: 1,
      },
    },
  })

  // Агрегируем данные
  let totalViews = 0
  let totalFollowerGain = 0
  let totalWatchThrough = 0
  let metricsCount = 0

  const uploadsWithMetrics: UploadWithMetrics[] = uploads.map((u) => {
    const latest = u.metrics[0] || null

    if (latest) {
      totalViews += latest.views
      totalFollowerGain += latest.followerGain
      totalWatchThrough += latest.watchThrough
      metricsCount++
    }

    return {
      id: u.id,
      videoId: u.videoId,
      socialAccountId: u.socialAccountId,
      status: u.status as UploadWithMetrics["status"],
      postStatus: u.postStatus as UploadWithMetrics["postStatus"],
      platformPostId: u.platformPostId,
      platformPostUrl: u.platformPostUrl,
      title: u.title,
      description: u.description,
      hashtags: u.hashtags,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      socialAccount: u.socialAccount,
      video: u.video,
      latestMetrics: latest
        ? {
            id: latest.id,
            uploadId: latest.uploadId,
            views: latest.views,
            likes: latest.likes,
            comments: latest.comments,
            shares: latest.shares,
            watchThrough: latest.watchThrough,
            ctr: latest.ctr,
            followerGain: latest.followerGain,
            collectedAt: latest.collectedAt.toISOString(),
          }
        : null,
    }
  })

  const avgWatchThrough = metricsCount > 0
    ? Math.round((totalWatchThrough / metricsCount) * 100) / 100
    : 0

  // Лучший пост по просмотрам
  const bestPost = uploadsWithMetrics
    .filter((u) => u.latestMetrics)
    .sort((a, b) => (b.latestMetrics?.views ?? 0) - (a.latestMetrics?.views ?? 0))[0] || null

  // Топ-5 по CTR
  const topCtrPosts = uploadsWithMetrics
    .filter((u) => u.latestMetrics && u.latestMetrics.ctr > 0)
    .sort((a, b) => (b.latestMetrics?.ctr ?? 0) - (a.latestMetrics?.ctr ?? 0))
    .slice(0, 5)

  const data: DashboardData = {
    totalViews,
    totalFollowerGain,
    avgWatchThrough,
    bestPost,
    topCtrPosts,
  }

  return { data }
})
