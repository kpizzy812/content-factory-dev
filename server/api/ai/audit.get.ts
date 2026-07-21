/**
 * GET /api/ai/audit
 * Получить историю AI-предложений с пагинацией и фильтрацией.
 *
 * Query params:
 *  - limit (max 50, default 20)
 *  - offset (default 0)
 *  - action: block_suggest | field_suggest | taxonomy_suggest
 *  - nodeType: фильтр по типу ноды
 *  - status: suggested | applied | partial | dismissed
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 20, 50)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const action = typeof query.action === 'string' ? query.action : undefined
  const nodeType = typeof query.nodeType === 'string' ? query.nodeType : undefined
  const status = typeof query.status === 'string' ? query.status : undefined
  const pipelineId = query.pipelineId ? Number(query.pipelineId) : undefined

  const where: Record<string, unknown> = {}
  if (action) where.action = action
  if (nodeType) where.nodeType = nodeType
  if (status) where.status = status
  if (pipelineId) where.pipelineId = pipelineId

  const [items, total] = await Promise.all([
    prisma.aiAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.aiAuditLog.count({ where }),
  ])

  // Статистика для dashboard-view
  const stats = await prisma.aiAuditLog.groupBy({
    by: ['status'],
    _count: { status: true },
    where: { ...(nodeType ? { nodeType } : {}), ...(pipelineId ? { pipelineId } : {}) },
  })

  const statusCounts: Record<string, number> = {}
  for (const s of stats) {
    statusCounts[s.status] = s._count.status
  }

  return { data: items, total, stats: statusCounts }
})
