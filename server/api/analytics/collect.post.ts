/**
 * POST /api/analytics/collect
 * Ручной сбор метрик. БЕЗ paid guard — сбор метрик бесплатный.
 *
 * Body (опционально):
 * - uploadIds: number[] — конкретные загрузки для сбора
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'analytics' })

  const body = await readBody(event)

  // Валидация uploadIds
  let uploadIds: number[] | undefined

  if (body?.uploadIds) {
    if (!Array.isArray(body.uploadIds)) {
      throw createError({
        statusCode: 400,
        message: "uploadIds должен быть массивом чисел",
      })
    }

    const parsed: number[] = body.uploadIds
      .map((id: unknown) => Number(id))
      .filter((id: number) => !Number.isNaN(id) && id > 0)

    if (parsed.length === 0) {
      throw createError({
        statusCode: 400,
        message: "Пустой список uploadIds",
      })
    }

    uploadIds = parsed
  }

  const result = await collectMetrics(uploadIds)

  return {
    data: {
      collected: result.collected,
      errorsCount: result.errors.length,
      errors: result.errors,
    },
  }
})
