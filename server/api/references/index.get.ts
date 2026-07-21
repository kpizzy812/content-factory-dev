import type { AnalyticsListMeta } from "../../../shared/types/analytics"

/**
 * GET /api/references
 * Список референсов (успешных роликов) с пагинацией.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'analytics' })

  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage

  const [references, total] = await Promise.all([
    prisma.reference.findMany({
      orderBy: { addedAt: "desc" },
      skip,
      take: perPage,
      include: {
        upload: {
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
        },
      },
    }),
    prisma.reference.count(),
  ])

  const data = references.map((ref) => {
    const latest = ref.upload.metrics[0] || null
    return {
      id: ref.id,
      uploadId: ref.uploadId,
      reason: ref.reason,
      aiAnalysis: ref.aiAnalysis,
      addedAt: ref.addedAt.toISOString(),
      upload: {
        id: ref.upload.id,
        videoId: ref.upload.videoId,
        socialAccountId: ref.upload.socialAccountId,
        status: ref.upload.status,
        postStatus: ref.upload.postStatus,
        platformPostId: ref.upload.platformPostId,
        platformPostUrl: ref.upload.platformPostUrl,
        title: ref.upload.title,
        description: ref.upload.description,
        hashtags: ref.upload.hashtags,
        createdAt: ref.upload.createdAt.toISOString(),
        updatedAt: ref.upload.updatedAt.toISOString(),
        socialAccount: ref.upload.socialAccount,
        video: ref.upload.video,
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
      },
    }
  })

  const meta: AnalyticsListMeta = {
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  }

  return { data, meta }
})
