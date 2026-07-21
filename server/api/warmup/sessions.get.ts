/**
 * GET /api/warmup/sessions
 * Глобальный список warmup-сессий с фильтрами и пагинацией.
 *
 * Query:
 *   accountId: number — фильтр по аккаунту
 *   status: WarmupSessionStatus | comma-separated — фильтр по статусу
 *   from: ISO datetime
 *   to: ISO datetime
 *   limit: number (default 50, max 200)
 *   offset: number (default 0)
 */
import type { WarmupSessionStatus } from "~~/app/generated/prisma/client"
import { WARMUP_SESSION_STATUSES } from "~~/shared/types/warmup"

function parseStatusFilter(raw: unknown): WarmupSessionStatus[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : String(raw).split(",")
  const out: WarmupSessionStatus[] = []
  for (const item of arr) {
    const v = String(item).trim()
    if ((WARMUP_SESSION_STATUSES as readonly string[]).includes(v)) {
      out.push(v as WarmupSessionStatus)
    }
  }
  return out
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const query = getQuery(event)

  const accountIdRaw = query.accountId
  const accountId = accountIdRaw !== undefined ? Number(accountIdRaw) : undefined
  const socialAccountId =
    accountId !== undefined && Number.isFinite(accountId) && accountId > 0
      ? accountId
      : undefined

  const statuses = parseStatusFilter(query.status)

  let from: Date | undefined
  if (typeof query.from === "string") {
    const d = new Date(query.from)
    if (!Number.isNaN(d.getTime())) from = d
  }
  let to: Date | undefined
  if (typeof query.to === "string") {
    const d = new Date(query.to)
    if (!Number.isNaN(d.getTime())) to = d
  }

  const limitRaw = Number(query.limit ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
  const offsetRaw = Number(query.offset ?? 0)
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  return listSessions({
    socialAccountId,
    status: statuses.length > 0 ? statuses : undefined,
    from,
    to,
    limit,
    offset,
  })
})
