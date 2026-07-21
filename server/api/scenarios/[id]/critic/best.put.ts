/**
 * PUT /api/scenarios/:id/critic/best
 * Body: { variantId: number }
 * Оператор подтверждает или меняет AI-выбор bestVariant: scenario.selectedVariantId = variantId.
 * Не дублирует /select.put.ts — здесь специфика именно critic-flow (вызывается из ScenarioCriticReportModal).
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const body = await readBody<{ variantId?: number }>(event)
  if (!body?.variantId || typeof body.variantId !== 'number' || body.variantId <= 0) {
    throw createError({ statusCode: 400, message: "Поле 'variantId' обязательно и должно быть числом > 0" })
  }

  const variant = await prisma.scenarioVariant.findUnique({
    where: { id: body.variantId },
    select: { id: true, scenarioId: true, isDeleted: true },
  })
  if (!variant || variant.scenarioId !== id) {
    throw createError({ statusCode: 404, message: 'Вариант не найден в этом сценарии' })
  }
  if (variant.isDeleted) {
    throw createError({ statusCode: 400, message: 'Вариант удалён' })
  }

  const updated = await prisma.scenario.update({
    where: { id },
    data: { selectedVariantId: variant.id },
    select: { id: true, selectedVariantId: true, status: true },
  })

  return { data: updated }
})
