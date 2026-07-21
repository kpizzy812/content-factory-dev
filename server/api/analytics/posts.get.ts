import type { AnalyticsListMeta, UploadWithMetrics } from "../../../shared/types/analytics"

const VALID_SORT_FIELDS = [
  "views", "likes", "comments", "shares",
  "watchThrough", "ctr", "followerGain", "createdAt",
] as const

const VALID_POST_STATUSES = ["active", "deleted", "blocked"] as const
const VALID_PLATFORMS = ["youtube", "tiktok", "instagram"] as const

/**
 * GET /api/analytics/posts
 * Таблица с метриками, фильтры, сортировка, пагинация.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'analytics' })

  const query = getQuery(event)

  // Пагинация
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage

  // Фильтры для Prisma where
  const where: Record<string, unknown> = {
    status: "published",
  }

  // Фильтр по appId и platform через socialAccount
  const socialAccountFilter: Record<string, unknown> = {}
  if (query.appId) {
    const appId = Number(query.appId)
    if (!Number.isNaN(appId) && appId > 0) {
      socialAccountFilter.appId = appId
    }
  }
  if (query.platform && VALID_PLATFORMS.includes(query.platform as typeof VALID_PLATFORMS[number])) {
    socialAccountFilter.platform = query.platform
  }
  if (Object.keys(socialAccountFilter).length > 0) {
    where.socialAccount = socialAccountFilter
  }

  if (query.socialAccountId) {
    const accountId = Number(query.socialAccountId)
    if (!Number.isNaN(accountId) && accountId > 0) {
      where.socialAccountId = accountId
    }
  }

  // --- Pipeline/run filter: фильтрация "К юниту" из монитора исполнений.
  // Upload сам хранит runId/pipelineId — фильтруем напрямую.
  const runIdFilter = Number(query.runId)
  if (Number.isFinite(runIdFilter) && runIdFilter > 0) {
    where.runId = runIdFilter
  }
  const pipelineIdFilter = Number(query.pipelineId)
  if (Number.isFinite(pipelineIdFilter) && pipelineIdFilter > 0) {
    where.pipelineId = pipelineIdFilter
  }

  if (query.postStatus && VALID_POST_STATUSES.includes(query.postStatus as typeof VALID_POST_STATUSES[number])) {
    where.postStatus = query.postStatus
  }

  if (query.dateFrom || query.dateTo) {
    const dateFilter: Record<string, Date> = {}
    if (query.dateFrom) dateFilter.gte = new Date(String(query.dateFrom))
    if (query.dateTo) dateFilter.lte = new Date(String(query.dateTo))
    where.createdAt = dateFilter
  }

  // Сортировка
  const sortBy = VALID_SORT_FIELDS.includes(query.sortBy as typeof VALID_SORT_FIELDS[number])
    ? (query.sortBy as string)
    : "createdAt"
  const sortOrder = query.sortOrder === "asc" ? "asc" : "desc"

  // Запрос: если сортировка по метрике, сортируем в памяти
  const isMetricSort = sortBy !== "createdAt"

  const [uploads, total] = await Promise.all([
    prisma.upload.findMany({
      where,
      ...(!isMetricSort ? { orderBy: { createdAt: sortOrder } } : {}),
      ...(isMetricSort ? {} : { skip, take: perPage }),
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
    }),
    prisma.upload.count({ where }),
  ])

  let mapped: UploadWithMetrics[] = uploads.map((u) => {
    const latest = u.metrics[0] || null
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

  // Сортировка по метрике в памяти + пагинация
  if (isMetricSort) {
    const key = sortBy as keyof NonNullable<UploadWithMetrics["latestMetrics"]>
    mapped.sort((a, b) => {
      const aVal = (a.latestMetrics?.[key] as number) ?? 0
      const bVal = (b.latestMetrics?.[key] as number) ?? 0
      return sortOrder === "asc" ? aVal - bVal : bVal - aVal
    })
    mapped = mapped.slice(skip, skip + perPage)
  }

  const meta: AnalyticsListMeta = {
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  }

  return { data: mapped, meta }
})
