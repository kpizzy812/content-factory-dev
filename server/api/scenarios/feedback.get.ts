export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'script-generator',
  })

  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage

  const where: Record<string, unknown> = {}

  if (query.scenarioId) {
    const scenarioId = Number(query.scenarioId)
    if (!Number.isNaN(scenarioId) && scenarioId > 0) {
      where.scenarioId = scenarioId
    }
  }

  if (query.videoId) {
    const videoId = Number(query.videoId)
    if (!Number.isNaN(videoId) && videoId > 0) {
      where.videoId = videoId
    }
  }

  if (query.uploadId) {
    const uploadId = Number(query.uploadId)
    if (!Number.isNaN(uploadId) && uploadId > 0) {
      where.uploadId = uploadId
    }
  }

  const [feedbacks, total] = await Promise.all([
    prisma.scenarioFeedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: perPage,
      include: {
        scenario: {
          select: {
            id: true,
            status: true,
            variants: {
              where: { isDeleted: false },
              orderBy: { variantIndex: 'asc' },
              take: 1,
              select: { title: true },
            },
          },
        },
      },
    }),
    prisma.scenarioFeedback.count({ where }),
  ])

  return {
    data: feedbacks,
    meta: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    },
  }
})
