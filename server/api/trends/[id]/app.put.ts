export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'trendwatcher',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Некорректный ID тренда' })
  }

  const body = await readBody<{ appId: number }>(event)
  if (!body?.appId || typeof body.appId !== 'number') {
    throw createError({ statusCode: 400, message: 'appId обязателен' })
  }

  // Проверить что приложение существует
  const app = await prisma.app.findUnique({ where: { id: body.appId } })
  if (!app) {
    throw createError({ statusCode: 404, message: 'Приложение не найдено' })
  }

  const trend = await prisma.trend.update({
    where: { id },
    data: { appId: body.appId },
    include: { app: true },
  })

  return { data: trend }
})
