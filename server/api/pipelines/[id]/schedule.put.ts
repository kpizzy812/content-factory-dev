export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID конвейера' })
  }

  const body = await readBody<{ cronExpr?: string; enabled?: boolean }>(event)

  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, message: 'Тело запроса обязательно' })
  }

  const pipeline = await prisma.pipeline.findUnique({ where: { id } })

  if (!pipeline) {
    throw createError({ statusCode: 404, message: 'Конвейер не найден' })
  }

  if (pipeline.userId !== user.id && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Только владелец может управлять расписанием' })
  }

  const cronExpr = typeof body.cronExpr === 'string' ? body.cronExpr.trim() : undefined
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined

  if (cronExpr !== undefined && !isValidCron(cronExpr)) {
    throw createError({
      statusCode: 400,
      message: 'Невалидное cron-выражение. Формат: минута час день месяц день_недели',
    })
  }

  const existing = await prisma.pipelineSchedule.findUnique({
    where: { pipelineId: id },
  })

  const now = new Date()
  const finalCron = cronExpr ?? existing?.cronExpr
  const finalEnabled = enabled ?? existing?.enabled ?? true

  if (!finalCron) {
    throw createError({ statusCode: 400, message: 'cronExpr обязателен при создании расписания' })
  }

  const nextRunAt = finalEnabled ? getNextRunTime(finalCron, now) : null

  const schedule = await prisma.pipelineSchedule.upsert({
    where: { pipelineId: id },
    create: {
      pipelineId: id,
      cronExpr: finalCron,
      enabled: finalEnabled,
      nextRunAt,
    },
    update: {
      cronExpr: finalCron,
      enabled: finalEnabled,
      nextRunAt,
    },
  })

  return { data: schedule }
})
