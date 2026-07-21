/**
 * POST /api/warmup/sessions/:id/cancel
 * Отмена planned warmup-сессии. running и terminal-статусы запрещены (409).
 */
import { toSessionDto } from "~~/server/utils/warmup/dto"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор сессии" })
  }

  const session = await cancelSession(id)
  return { data: toSessionDto(session) }
})
