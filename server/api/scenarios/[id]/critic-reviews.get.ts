/**
 * GET /api/scenarios/:id/critic-reviews
 * Список Critic-ревью для сценария, последняя итерация первой.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const reviews = await prisma.criticReview.findMany({
    where: { scenarioId: id },
    orderBy: [{ iteration: 'desc' }, { createdAt: 'desc' }],
  })

  return {
    data: reviews,
    meta: { total: reviews.length },
  }
})
