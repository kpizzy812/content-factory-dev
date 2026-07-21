/**
 * GET /api/warmup/accounts/:accountId/sessions
 * История warmup-сессий по конкретному аккаунту.
 *
 * Query:
 *   limit: number (default 20, max 200)
 *   offset: number (default 0)
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const accountIdParam = getRouterParam(event, "accountId")
  const accountId = Number(accountIdParam)
  if (!Number.isFinite(accountId) || accountId <= 0) {
    throw createError({ statusCode: 400, message: "Неверный accountId" })
  }

  const query = getQuery(event)
  const limitRaw = Number(query.limit ?? 20)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 20
  const offsetRaw = Number(query.offset ?? 0)
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  return listSessionsForAccount(accountId, { limit, offset })
})
