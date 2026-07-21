export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID идеи',
    })
  }

  const idea = await prisma.idea.findUnique({
    where: { id },
    include: {
      app: { select: { id: true, name: true } },
      analysis: true,
      operatorActions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  })

  if (!idea || idea.isDeleted) {
    throw createError({
      statusCode: 404,
      message: 'Идея не найдена',
    })
  }

  return { data: idea }
})
