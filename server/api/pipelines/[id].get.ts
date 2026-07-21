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
    include: { tags: { select: { id: true, name: true } } },
  })

  if (!pipeline) {
    throw createError({
      statusCode: 404,
      message: 'Конвейер не найден',
    })
  }

  // Проверка доступа: владелец, расшарен или admin
  const isOwner = pipeline.userId === user.id
  const isShared = pipeline.sharedWith.includes(user.id)

  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Нет доступа к этому конвейеру',
    })
  }

  return { data: pipeline }
})
