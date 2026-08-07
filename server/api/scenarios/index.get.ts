import type { ScenarioListMeta } from '../../../shared/types/scenario'

const VALID_STATUSES = ['draft', 'generating', 'generated', 'selected', 'rejected', 'needs_rework', 'archived'] as const
const SORT_FIELDS = ['createdAt', 'updatedAt', 'status'] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'script-generator' })

  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage
  const orderBy = toOrderBy(parseSort(query, { allowed: SORT_FIELDS, defaultField: 'createdAt' }))

  const where: Record<string, unknown> = {
    isDeleted: false,
  }

  if (query.trendId) {
    const trendId = Number(query.trendId)
    if (!Number.isNaN(trendId) && trendId > 0) {
      where.trendId = trendId
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

  if (query.status && VALID_STATUSES.includes(query.status as typeof VALID_STATUSES[number])) {
    where.status = query.status
  }

  if (query.includeDeleted === 'true') {
    delete where.isDeleted
  }

  const [scenarios, total] = await Promise.all([
    prisma.scenario.findMany({
      where,
      orderBy,
      skip,
      take: perPage,
      include: {
        trend: {
          select: { id: true, title: true, platform: true },
        },
        variants: {
          where: { isDeleted: false },
          orderBy: { variantIndex: 'asc' },
          select: {
            id: true,
            variantIndex: true,
            status: true,
            title: true,
            hook: true,
            createdAt: true,
          },
        },
        _count: { select: { reviewActions: true } },
      },
    }),
    prisma.scenario.count({ where }),
  ])

  const meta: ScenarioListMeta = {
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  }

  return { data: scenarios, meta }
})
