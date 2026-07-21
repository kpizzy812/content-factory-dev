import type { PipelineListMeta } from '../../shared/types/pipeline'

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const query = getQuery(event)

  // Pagination
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage

  // Фильтр: конвейеры пользователя + расшаренные с ним
  const where = user.canAdmin
    ? {}
    : {
        OR: [
          { userId: user.id },
          { sharedWith: { has: user.id } },
        ],
      }

  const [pipelines, total] = await Promise.all([
    prisma.pipeline.findMany({
      where,
      orderBy: { updatedAt: 'desc' as const },
      skip,
      take: perPage,
      include: { tags: { select: { id: true, name: true } } },
    }),
    prisma.pipeline.count({ where }),
  ])

  // Добавляем count нод из graphData
  const data = pipelines.map((p) => {
    const graph = p.graphData as { nodes?: unknown[] } | null
    const nodesCount = Array.isArray(graph?.nodes) ? graph.nodes.length : 0
    return { ...p, nodesCount }
  })

  const meta: PipelineListMeta = {
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  }

  return { data, meta }
})
