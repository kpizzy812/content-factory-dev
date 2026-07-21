import type { IdeaListMeta } from '../../shared/types/idea'

const VALID_STATUSES = ['pending', 'processing', 'ready', 'in_work', 'completed', 'failed'] as const
const VALID_SOURCES = ['manual', 'telegram', 'pipeline', 'marketingcamp'] as const
const VALID_ANALYSIS_STATUSES = ['none', 'pending', 'running', 'completed', 'failed'] as const
const VALID_SYNC_STATUSES = ['none', 'synced', 'pending_export', 'pending_import', 'conflict', 'error'] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'script-generator',
  })

  const query = getQuery(event)

  // Pagination
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage

  // Filters
  const where: Record<string, unknown> = {
    isDeleted: false,
  }

  if (query.status && VALID_STATUSES.includes(query.status as typeof VALID_STATUSES[number])) {
    where.status = query.status
  }

  if (query.source && VALID_SOURCES.includes(query.source as typeof VALID_SOURCES[number])) {
    where.source = query.source
  }

  if (query.analysisStatus && VALID_ANALYSIS_STATUSES.includes(query.analysisStatus as typeof VALID_ANALYSIS_STATUSES[number])) {
    where.analysisStatus = query.analysisStatus
  }

  if (query.syncStatus && VALID_SYNC_STATUSES.includes(query.syncStatus as typeof VALID_SYNC_STATUSES[number])) {
    where.syncStatus = query.syncStatus
  }

  if (query.appId) {
    const appId = Number(query.appId)
    if (!Number.isNaN(appId) && appId > 0) {
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

  const [ideas, total] = await Promise.all([
    prisma.idea.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: perPage,
      include: {
        app: { select: { id: true, name: true } },
      },
    }),
    prisma.idea.count({ where }),
  ])

  const meta: IdeaListMeta = {
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  }

  return { data: ideas, meta }
})
