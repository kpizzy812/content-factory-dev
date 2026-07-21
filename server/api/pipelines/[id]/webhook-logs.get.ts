/**
 * Get webhook request logs for a pipeline.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID' })
  }

  const query = getQuery(event)
  const page = Math.max(Number(query.page) || 1, 1)
  const perPage = Math.min(Math.max(Number(query.perPage) || 20, 1), 100)

  const [logs, total] = await Promise.all([
    prisma.webhookLog.findMany({
      where: { pipelineId: id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.webhookLog.count({ where: { pipelineId: id } }),
  ])

  return {
    data: logs,
    meta: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    },
  }
})
