/**
 * GET /api/warmup/sessions/:id
 * Возвращает детальную инфу о warmup-сессии (включая plan и executedActions).
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор сессии" })
  }

  const session = await getSession(id)
  return { data: session }
})
