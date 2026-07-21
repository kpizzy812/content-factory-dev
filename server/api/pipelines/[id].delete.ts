export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canDelete'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID конвейера',
    })
  }

  const existing = await prisma.pipeline.findUnique({ where: { id } })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Конвейер не найден',
    })
  }

  // Только владелец или admin
  if (existing.userId !== user.id && !user.canAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Только владелец может удалить конвейер',
    })
  }

  await prisma.pipeline.delete({ where: { id } })

  return { data: { id }, meta: { deleted: true } }
})
