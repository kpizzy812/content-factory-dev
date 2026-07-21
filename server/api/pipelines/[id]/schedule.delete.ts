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
    throw createError({ statusCode: 403, message: 'Только владелец может удалить расписание' })
  }

  const schedule = await prisma.pipelineSchedule.findUnique({
    where: { pipelineId: id },
  })

  if (!schedule) {
    throw createError({ statusCode: 404, message: 'Расписание не найдено' })
  }

  await prisma.pipelineSchedule.delete({
    where: { pipelineId: id },
  })

  return { data: { deleted: true } }
})
