import type { VideoListMeta } from "../../../shared/types/video"

const VALID_STATUSES = [
  "pending", "configuring", "generating_prompts",
  "generating_images", "generating_clips",
  "generating_music", "assembling",
  "completed", "failed", "canceled",
] as const
const SORT_FIELDS = ['createdAt', 'updatedAt', 'status', 'duration', 'totalCostActual', 'finishedAt'] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'video-generator' })

  const query = getQuery(event)

  // Pagination
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 12))
  const skip = (page - 1) * perPage

  // Sort
  const orderBy = toOrderBy(
    parseSort(query, { allowed: SORT_FIELDS, defaultField: 'createdAt' }),
    ['totalCostActual', 'duration', 'finishedAt'],
  )

  // Filters
  const where: Record<string, unknown> = {}

  if (query.status && VALID_STATUSES.includes(query.status as typeof VALID_STATUSES[number])) {
    where.status = query.status
  }

  if (query.scenarioId) {
    const scenarioId = Number(query.scenarioId)
    if (!Number.isNaN(scenarioId) && scenarioId > 0) {
      where.scenarioId = scenarioId
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

  const [videos, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy,
      skip,
      take: perPage,
      include: {
        assets: {
          where: { type: "image" },
          select: { type: true, fileUrl: true },
          orderBy: { order: "asc" },
          take: 1,
        },
        scenario: {
          select: {
            id: true,
            selectedVariantId: true,
            variants: {
              where: { status: 'accepted' },
              select: { title: true },
              take: 1,
            },
          },
        },
      },
    }),
    prisma.video.count({ where }),
  ])

  const meta: VideoListMeta = {
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  }

  return { data: videos, meta }
})
