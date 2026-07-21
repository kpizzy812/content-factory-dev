/**
 * PUT /api/scenarios/:id/rework
 * Отправка варианта на переработку с причиной.
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

  await prisma.$transaction(async (tx) => {
    await tx.scenarioVariant.update({
      where: { id: body.variantId! },
      data: { status: 'needs_rework' },
    })

    await tx.scenario.update({
      where: { id },
      data: {
        status: 'needs_rework',
        reworkRequest: body.reason || null,
      },
    })

    await tx.scenarioReviewAction.create({
      data: {
        scenarioId: id,
        variantId: body.variantId!,
        actionType: 'rework',
        reason: body.reason || null,
      },
    })
  })

  // Автоматически запускаем AI-переработку (fire-and-forget)
  $fetch(`/api/scenarios/${id}/rework-regenerate`, {
    method: 'POST',
    body: { variantId: body.variantId },
    headers: {
      cookie: getHeader(event, 'cookie') || '',
    },
  }).catch((err) => {
    // Логируем ошибку, но не блокируем ответ
    console.error(`[rework] Auto-regeneration failed for scenario ${id}:`, err?.message || err)
  })

  return { data: { variantId: body.variantId, status: 'needs_rework', regenerating: true } }
})
