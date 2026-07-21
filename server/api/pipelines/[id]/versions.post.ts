export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
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

  if (pipeline.userId !== user.id && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Только владелец может создавать версии' })
  }

  const body = await readBody<{ name?: string; description?: string }>(event).catch(() => null)
  const versionName = body && typeof body.name === 'string' ? body.name.trim().slice(0, 100) || null : null
  const versionDescription = body && typeof body.description === 'string' ? body.description.trim().slice(0, 500) || null : null

  // Определяем следующий номер версии
  const lastVersion = await prisma.pipelineVersion.findFirst({
    where: { pipelineId: id },
    orderBy: { version: 'desc' },
    select: { version: true },
  })

  const nextVersion = (lastVersion?.version ?? 0) + 1

  const version = await prisma.pipelineVersion.create({
    data: {
      pipelineId: id,
      version: nextVersion,
      graphData: pipeline.graphData ?? {},
      name: versionName,
      description: versionDescription,
      createdById: user.id,
    },
  })

  return { data: version }
})
