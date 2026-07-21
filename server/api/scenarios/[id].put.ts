/**
 * PUT /api/scenarios/:id
 * Обновление полей варианта сценария.
 * Требует variantId в теле запроса.
 */
const ALLOWED_FIELDS = ['title', 'hook', 'body', 'cta', 'fullScript', 'visualStyleText'] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canWrite'], moduleSlug: 'script-generator' })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, message: 'Тело запроса обязательно' })
  }

  const variantId = Number(body.variantId)
  if (!variantId || Number.isNaN(variantId)) {
    throw createError({ statusCode: 400, message: "Поле 'variantId' обязательно" })
  }

  const data: Record<string, string> = {}
  for (const field of ALLOWED_FIELDS) {
    if (field in body && typeof body[field] === 'string') {
      data[field] = body[field] as string
    }
  }

  if (Object.keys(data).length === 0) {
    throw createError({
      statusCode: 400,
      message: `Необходимо указать хотя бы одно поле: ${ALLOWED_FIELDS.join(', ')}`,
    })
  }

  const variant = await prisma.scenarioVariant.findUnique({
    where: { id: variantId },
    include: { scenario: true },
  })

  if (!variant || variant.scenarioId !== id) {
    throw createError({ statusCode: 404, message: 'Вариант не найден' })
  }

  if (variant.status === 'rejected') {
    throw createError({ statusCode: 400, message: 'Нельзя редактировать отклонённый вариант' })
  }

  if (variant.scenario.isDeleted) {
    throw createError({ statusCode: 400, message: 'Нельзя редактировать удалённый сценарий' })
  }

  const updated = await prisma.scenarioVariant.update({
    where: { id: variantId },
    data,
  })

  return { data: updated }
})
