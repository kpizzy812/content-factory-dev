/**
 * DELETE /api/warmup/sessions/:id
 *
 * Полное удаление warmup-сессии из БД. Разрешено только для terminal-статусов
 * (planned/cancelled/failed). running/completed → 409.
 *
 * Требуется RBAC canDelete на модуль social-upload.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор сессии" })
  }

  await deleteSession(id)
  setResponseStatus(event, 200)
  return { data: { deleted: true } }
})
