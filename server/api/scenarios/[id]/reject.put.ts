/**
 * PUT /api/scenarios/:id/reject
 * Отклонение варианта сценария.
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const body = await readBody<{ variantId?: number; reason?: string }>(event)
  if (!body?.variantId || typeof body.variantId !== 'number') {
    throw createError({ statusCode: 400, message: "Поле 'variantId' обязательно" })
  }

  const variant = await prisma.scenarioVariant.findUnique({
    where: { id: body.variantId },
    include: { scenario: true },
  })

  if (!variant || variant.scenarioId !== id) {
    throw createError({ statusCode: 404, message: 'Вариант не найден' })
  }

  await requireScopedAccess(event, {
    permissions: ['canApprove'],
    moduleSlug: 'script-generator',
    appId: variant.scenario.appId ?? undefined,
  })

  if (variant.scenario.isDeleted) {
    throw createError({ statusCode: 400, message: 'Нельзя работать с удалённым сценарием' })
  }

  if (variant.status === 'rejected') {
    throw createError({ statusCode: 400, message: 'Вариант уже отклонён' })
  }

  await prisma.$transaction(async (tx) => {
    await tx.scenarioVariant.update({
      where: { id: body.variantId! },
      data: { status: 'rejected' },
    })

    await tx.scenarioReviewAction.create({
      data: {
        scenarioId: id,
        variantId: body.variantId!,
        actionType: 'reject',
        reason: body.reason || null,
      },
    })

    // Если все варианты rejected — сценарий тоже rejected
    const remainingActive = await tx.scenarioVariant.count({
      where: {
        scenarioId: id,
        isDeleted: false,
        status: { notIn: ['rejected', 'superseded'] },
      },
    })

    if (remainingActive === 0) {
      await tx.scenario.update({
        where: { id },
        data: { status: 'rejected' },
      })
    }
  })

  return { data: { variantId: body.variantId, status: 'rejected' } }
})
