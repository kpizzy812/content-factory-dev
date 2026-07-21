import type { TrendListMeta } from "../../../shared/types/trend"

const VALID_SORT_FIELDS = ["importedAt", "viewCount"] as const
const VALID_STATUSES = ["new", "reviewed", "in_work", "completed", "dismissed"] as const
const VALID_PLATFORMS = ["tiktok", "instagram", "youtube"] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'trendwatcher' })

  const query = getQuery(event)

  // Pagination
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage

  // Sort
  const sortBy = VALID_SORT_FIELDS.includes(query.sort as typeof VALID_SORT_FIELDS[number])
    ? (query.sort as string)
    : "importedAt"
  const orderBy = { [sortBy]: "desc" as const }

  // Filters
  const where: Record<string, unknown> = {
    isDeleted: false,
  }

  if (query.status && VALID_STATUSES.includes(query.status as typeof VALID_STATUSES[number])) {
    where.status = query.status
  }

  if (query.platform && VALID_PLATFORMS.includes(query.platform as typeof VALID_PLATFORMS[number])) {
    where.platform = query.platform
  }

  if (query.appId) {
    const appId = Number(query.appId)
    if (!Number.isNaN(appId)) {
      where.appId = appId
    }
  }

  // --- Pipeline/run filter: фильтрация "К юниту" из монитора исполнений ---
  const runIdFilter = Number(query.runId)
  if (Number.isFinite(runIdFilter) && runIdFilter > 0) {
    where.runId = runIdFilter
  }
  const pipelineIdFilter = Number(query.pipelineId)
  if (Number.isFinite(pipelineIdFilter) && pipelineIdFilter > 0) {
    where.pipelineId = pipelineIdFilter
  }

  if (query.source === 'mc') {
    where.externalId = { not: null }
  } else if (query.source === 'local') {
    where.externalId = null
  }

  if (query.search && typeof query.search === "string" && query.search.trim().length > 0) {
    const search = query.search.trim()
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ]
  }

  // Hashtag filter (post-filtering in DB via array overlap)
  if (query.hashtags && typeof query.hashtags === "string" && query.hashtags.trim().length > 0) {
    const tags = query.hashtags.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean)
    if (tags.length > 0) {
      where.hashtags = { hasSome: tags }
    }
  }

  // Geo filter (post-filtering by stored geo field)
  if (query.geo && typeof query.geo === "string" && query.geo.trim().length > 0) {
    where.geo = { equals: query.geo.trim(), mode: "insensitive" }
  }

  // Language filter (post-filtering by stored language field)
  if (query.language && typeof query.language === "string" && query.language.trim().length > 0) {
    where.language = { equals: query.language.trim(), mode: "insensitive" }
  }

  // View count range filter
  const viewCountFilter: Record<string, number> = {}
  if (query.viewCountMin) {
    const min = Number(query.viewCountMin)
    if (!Number.isNaN(min) && min >= 0) {
      viewCountFilter.gte = min
    }
  }
  if (query.viewCountMax) {
    const max = Number(query.viewCountMax)
    if (!Number.isNaN(max) && max >= 0) {
      viewCountFilter.lte = max
    }
  }
  if (Object.keys(viewCountFilter).length > 0) {
    where.viewCount = viewCountFilter
  }

  // Analysis status filter
  if (query.analysisStatus && typeof query.analysisStatus === "string") {
    const validAnalysis = ["none", "pending", "running", "completed", "failed"]
    if (validAnalysis.includes(query.analysisStatus)) {
      where.analysisStatus = query.analysisStatus
    }
  }

  const [trends, total] = await Promise.all([
    prisma.trend.findMany({
      where,
      orderBy,
      skip,
      take: perPage,
      include: {
        app: true,
        insights: true,
        brief: true,
      },
    }),
    prisma.trend.count({ where }),
  ])

  const meta: TrendListMeta = {
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  }

  return { data: trends, meta }
})
