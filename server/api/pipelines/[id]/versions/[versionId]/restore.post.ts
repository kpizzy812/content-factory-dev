export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  const versionId = Number(getRouterParam(event, 'versionId'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID конвейера' })
  }

  if (Number.isNaN(versionId) || versionId <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID версии' })
  }

  const pipeline = await prisma.pipeline.findUnique({ where: { id } })

  if (!pipeline) {
    throw createError({ statusCode: 404, message: 'Конвейер не найден' })
  }

  if (pipeline.userId !== user.id && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Только владелец может восстанавливать версии' })
  }

  const version = await prisma.pipelineVersion.findFirst({
    where: { id: versionId, pipelineId: id },
  })

  if (!version) {
    throw createError({ statusCode: 404, message: 'Версия не найдена' })
  }

  const updated = await prisma.pipeline.update({
    where: { id },
    data: { graphData: version.graphData ?? {} },
  })

  return { data: updated }
})
