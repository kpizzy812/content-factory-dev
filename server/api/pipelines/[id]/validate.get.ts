/**
 * Pipeline validation / readiness check.
 * Returns structured validation issues and readiness checklist.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID конвейера' })
  }

  const result = await validatePipeline(id)
  return { data: result }
})
