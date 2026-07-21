/**
 * GET /api/proxies/:id/deep-check-history
 *
 * Возвращает последние N логов deep-check для прокси (без fullResult).
 * Используется в DeepCheckHistoryModal для отображения timeline проверок.
 *
 * Query:
 *   limit (default 20, max 100)
 *
 * Permissions: canRead — просмотр истории.
 */

import { prisma } from "~~/server/utils/prisma"
import type { DeepProxyCheckLogSummary } from "~~/shared/types/deep-proxy-check"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const proxyId = getRouterParam(event, "id")
  if (!proxyId || typeof proxyId !== "string") {
    throw createError({ statusCode: 400, message: "Неверный ID прокси" })
  }

  const query = getQuery(event)
  let limit = DEFAULT_LIMIT
  if (query.limit !== undefined) {
    const n = Number(query.limit)
    if (!Number.isFinite(n) || n <= 0 || n > MAX_LIMIT) {
      throw createError({
        statusCode: 400,
        message: `limit должен быть числом 1..${MAX_LIMIT}`,
      })
    }
    limit = n
  }

  // Подтверждаем что proxy существует — иначе 404 (а не пустой массив,
  // чтобы UI отличал "нет логов" от "нет такого proxy").
  const proxy = await prisma.proxy.findUnique({
    where: { id: proxyId },
    select: { id: true },
  })
  if (!proxy) {
    throw createError({ statusCode: 404, message: `Proxy ${proxyId} не найден` })
  }

  const logs = await prisma.proxyDeepCheckLog.findMany({
    where: { proxyId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      proxyId: true,
      socialAccountId: true,
      deviceProfileId: true,
      initiatedById: true,
      triggeredFrom: true,
      outcome: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      detectedIp: true,
      detectedCountry: true,
      detectedCity: true,
      isLeaking: true,
      matchesProxyExpectation: true,
      proxyActuallyWorking: true,
      recommendation: true,
      createdAt: true,
    },
  })

  const data: DeepProxyCheckLogSummary[] = logs.map((l) => ({
    ...l,
    startedAt: l.startedAt.toISOString(),
    finishedAt: l.finishedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
  }))

  return { data }
})
