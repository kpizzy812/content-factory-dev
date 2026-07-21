/**
 * PUT /api/scenarios/:id/select
 * Принятие варианта сценария: variantId обязателен.
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const body = await readBody<{ variantId?: number }>(event)
  if (!body?.variantId || typeof body.variantId !== 'number') {
    throw createError({ statusCode: 400, message: "Поле 'variantId' обязательно" })
  }

  const scenario = await prisma.scenario.findUnique({
    where: { id },
    include: { variants: { where: { isDeleted: false } } },
  })

  if (!scenario) {
    throw createError({ statusCode: 404, message: 'Сценарий не найден' })
  }

  await requireScopedAccess(event, {
    permissions: ['canApprove'],
    moduleSlug: 'script-generator',
    appId: scenario.appId ?? undefined,
  })

  if (scenario.isDeleted) {
    throw createError({ statusCode: 400, message: 'Нельзя работать с удалённым сценарием' })
  }

  const variant = scenario.variants.find(v => v.id === body.variantId)
  if (!variant) {
    throw createError({ statusCode: 404, message: 'Вариант не найден в этом сценарии' })
  }

  if (variant.status === 'rejected') {
    throw createError({ statusCode: 400, message: 'Нельзя выбрать отклонённый вариант' })
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Все остальные варианты -> superseded
    await tx.scenarioVariant.updateMany({
      where: { scenarioId: id, id: { not: body.variantId }, isDeleted: false },
      data: { status: 'superseded' },
    })

    // Выбранный -> accepted
    await tx.scenarioVariant.update({
      where: { id: body.variantId! },
      data: { status: 'accepted' },
    })

    // Сценарий -> selected
    const result = await tx.scenario.update({
      where: { id },
      data: {
        status: 'selected',
        selectedVariantId: body.variantId!,
      },
      include: {
        variants: { where: { isDeleted: false }, orderBy: { variantIndex: 'asc' } },
        trend: { select: { id: true, title: true, platform: true } },
      },
    })

    // Тренд -> completed (только для trend-driven сценариев; shadow scenarios без trend пропускаем)
    if (scenario.trendId !== null) {
      await tx.trend.update({
        where: { id: scenario.trendId },
        data: { status: 'completed' },
      })
    }

    // Записываем review action
    await tx.scenarioReviewAction.create({
      data: {
        scenarioId: id,
        variantId: body.variantId!,
        actionType: 'accept',
      },
    })

    return result
  })

  return { data: updated }
})
