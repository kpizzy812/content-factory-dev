export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'script-generator',
  })

  const query = getQuery(event)

  const appId = query.appId ? Number(query.appId) : null

  if (query.appId !== undefined && (Number.isNaN(appId) || (appId !== null && appId <= 0))) {
    throw createError({
      statusCode: 400,
      message: "Поле 'appId' должно быть числом > 0",
    })
  }

  const memory = await buildOptimizationMemory(appId)

  return { data: memory }
})
