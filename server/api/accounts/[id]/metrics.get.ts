/**
 * GET /api/accounts/:id/metrics
 *
 * Возвращает историю снимков (AccountMetricsSnapshot) аккаунта.
 *
 * Query:
 *   ?limit=N      — лимит снимков, 1..100, дефолт 30
 *   ?status=ok    — фильтр по status ('ok' | 'error')
 *   ?includeRaw=1 — включить rawData (sampleSize + posts) в DTO; по умолчанию nullable
 *
 * Сортировка: fetchedAt DESC (новые первые).
 *
 * RBAC: canRead + moduleSlug=social-upload + appAccess + accountAccess.
 */
import { serializeSnapshot } from "../../../utils/account-metrics-serialize"

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export default defineEventHandler(async (event) => {
  // Auth-гейт первым: 401 должен возвращаться раньше 404
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      data: { message: "Неверный ID аккаунта", code: "invalid_id" },
    })
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: {
      id: true,
      appId: true,
      platform: true,
      platformHandle: true,
      displayName: true,
    },
  })
  if (!account) {
    throw createError({
      statusCode: 404,
      data: { message: "Аккаунт не найден", code: "account_not_found" },
    })
  }

  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
    appId: account.appId,
    accountName: account.displayName,
  })

  const query = getQuery(event)
  const rawLimit = Number(query.limit) || DEFAULT_LIMIT
  const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
  const statusFilter =
    query.status === "ok" || query.status === "error"
      ? (query.status as "ok" | "error")
      : undefined
  const includeRaw = query.includeRaw === "1" || query.includeRaw === "true"

  const whereClause = {
    socialAccountId: id,
    ...(statusFilter ? { status: statusFilter } : {}),
  }

  const [snapshots, total] = await Promise.all([
    prisma.accountMetricsSnapshot.findMany({
      where: whereClause,
      orderBy: { fetchedAt: "desc" },
      take: limit,
    }),
    prisma.accountMetricsSnapshot.count({ where: whereClause }),
  ])

  return {
    data: {
      snapshots: snapshots.map((s) => serializeSnapshot(s, { includeRaw })),
      total,
      platform: account.platform,
      platformHandle: account.platformHandle,
    },
  }
})
