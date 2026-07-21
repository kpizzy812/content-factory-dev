/**
 * DELETE /api/warmup/keywords/:id
 * Удаление keyword pool. Требуется canAdmin.
 */
export default defineEventHandler(async (event) => {
  // Pools globally manageable by canAdmin (single-tenant assumption).
  // Если перейдём к multi-tenant, нужно будет проверять existing.appId vs user.currentAppId.
  await requireScopedAccess(event, {
    permissions: ["canAdmin"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор pool" })
  }

  const existing = await prisma.warmupKeywordPool.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: `WarmupKeywordPool ${id} не найден` })
  }

  await prisma.warmupKeywordPool.delete({ where: { id } })
  setResponseStatus(event, 204)
  return null
})
