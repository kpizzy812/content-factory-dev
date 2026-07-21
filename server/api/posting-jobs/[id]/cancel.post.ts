/**
 * POST /api/posting-jobs/:id/cancel
 * Отмена PostingJob (только если не в terminal-статусе).
 *
 * Body:
 *   reason: string (required) — причина отмены
 */
interface CancelBody {
  reason?: unknown
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор job" })
  }

  const body = await readBody<CancelBody>(event)
  const reasonRaw = body?.reason
  if (typeof reasonRaw !== "string" || !reasonRaw.trim()) {
    throw createError({ statusCode: 400, message: "Поле 'reason' обязательно (непустая строка)" })
  }
  const reason = reasonRaw.trim().slice(0, 500)

  const job = await cancelJob(id, user.id, reason)
  return { data: job }
})
