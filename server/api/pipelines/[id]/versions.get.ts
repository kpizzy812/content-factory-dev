export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID конвейера' })
  }

  const pipeline = await prisma.pipeline.findUnique({ where: { id } })

  if (!pipeline) {
    throw createError({ statusCode: 404, message: 'Конвейер не найден' })
  }

  const isOwner = pipeline.userId === user.id
  const isShared = pipeline.sharedWith.includes(user.id)

  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Нет доступа к этому конвейеру' })
  }

  const versions = await prisma.pipelineVersion.findMany({
    where: { pipelineId: id },
    orderBy: { version: 'desc' },
    take: 50,
  })

  return { data: versions }
})
