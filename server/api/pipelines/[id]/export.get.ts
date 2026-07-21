export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID конвейера',
    })
  }

  const pipeline = await prisma.pipeline.findUnique({
    where: { id },
    include: { tags: { select: { name: true } } },
  })

  if (!pipeline) {
    throw createError({
      statusCode: 404,
      message: 'Конвейер не найден',
    })
  }

  const isOwner = pipeline.userId === user.id
  const isShared = pipeline.sharedWith.includes(user.id)

  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Нет доступа к этому конвейеру',
    })
  }

  const graphData = pipeline.graphData as { nodes?: any[]; edges?: any[] }
  const nodes = Array.isArray(graphData?.nodes) ? graphData.nodes : []
  const nodeTypes = [...new Set(nodes.map((n: any) => n?.data?.type).filter(Boolean))]

  return {
    data: {
      version: 1,
      exportedAt: new Date().toISOString(),
      meta: {
        nodeCount: nodes.length,
        edgeCount: Array.isArray(graphData?.edges) ? graphData.edges.length : 0,
        nodeTypes,
        exportedBy: user.id,
      },
      pipeline: {
        name: pipeline.name,
        description: pipeline.description,
        markdownDescription: pipeline.markdownDescription,
        icon: pipeline.icon,
        color: pipeline.color,
        tags: pipeline.tags.map(t => t.name),
        graphData: pipeline.graphData,
      },
    },
  }
})
