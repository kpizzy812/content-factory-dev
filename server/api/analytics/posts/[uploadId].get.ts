import type { PostMetrics, UploadWithMetrics } from "../../../../shared/types/analytics"

/**
 * GET /api/analytics/posts/:uploadId
 * Деталь загрузки + полная история метрик.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'analytics' })

  const uploadId = Number(getRouterParam(event, "uploadId"))
  if (!uploadId || Number.isNaN(uploadId) || uploadId <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID загрузки" })
  }

  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    include: {
      socialAccount: {
        select: { id: true, platform: true, displayName: true },
      },
      video: {
        select: { id: true, fileUrl: true, duration: true },
      },
      metrics: {
        orderBy: { collectedAt: "desc" },
      },
      references: true,
    },
  })

  if (!upload) {
    throw createError({ statusCode: 404, message: "Загрузка не найдена" })
  }

  const latestMetrics = upload.metrics[0] || null

  const metricsHistory: PostMetrics[] = upload.metrics.map((m) => ({
    id: m.id,
    uploadId: m.uploadId,
    views: m.views,
    likes: m.likes,
    comments: m.comments,
    shares: m.shares,
    watchThrough: m.watchThrough,
    ctr: m.ctr,
    followerGain: m.followerGain,
    collectedAt: m.collectedAt.toISOString(),
  }))

  const data: UploadWithMetrics & {
    metricsHistory: PostMetrics[]
    reference: { reason: string; aiAnalysis: string | null; addedAt: string } | null
  } = {
    id: upload.id,
    videoId: upload.videoId,
    socialAccountId: upload.socialAccountId,
    status: upload.status as UploadWithMetrics["status"],
    postStatus: upload.postStatus as UploadWithMetrics["postStatus"],
    platformPostId: upload.platformPostId,
    platformPostUrl: upload.platformPostUrl,
    title: upload.title,
    description: upload.description,
    hashtags: upload.hashtags,
    createdAt: upload.createdAt.toISOString(),
    updatedAt: upload.updatedAt.toISOString(),
    socialAccount: upload.socialAccount,
    video: upload.video,
    latestMetrics: latestMetrics
      ? {
          id: latestMetrics.id,
          uploadId: latestMetrics.uploadId,
          views: latestMetrics.views,
          likes: latestMetrics.likes,
          comments: latestMetrics.comments,
          shares: latestMetrics.shares,
          watchThrough: latestMetrics.watchThrough,
          ctr: latestMetrics.ctr,
          followerGain: latestMetrics.followerGain,
          collectedAt: latestMetrics.collectedAt.toISOString(),
        }
      : null,
    metricsHistory,
    reference: upload.references[0]
      ? {
          reason: upload.references[0].reason,
          aiAnalysis: upload.references[0].aiAnalysis,
          addedAt: upload.references[0].addedAt.toISOString(),
        }
      : null,
  }

  return { data }
})
