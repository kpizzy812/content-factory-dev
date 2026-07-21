/**
 * DELETE /api/scenarios/:id
 * Soft delete сценария и всех его вариантов.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canDelete'], moduleSlug: 'script-generator' })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const scenario = await prisma.scenario.findUnique({ where: { id } })
  if (!scenario) {
    throw createError({ statusCode: 404, message: 'Сценарий не найден' })
  }

  if (scenario.isDeleted) {
    throw createError({ statusCode: 400, message: 'Сценарий уже удалён' })
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.scenario.update({
      where: { id },
      data: { isDeleted: true, deletedAt: now, status: 'archived' },
    })

    await tx.scenarioVariant.updateMany({
      where: { scenarioId: id },
      data: { isDeleted: true, deletedAt: now },
    })

    await tx.scenarioReviewAction.create({
      data: {
        scenarioId: id,
        actionType: 'delete_scenario',
      },
    })
  })

  return { data: { id, deleted: true } }
})
