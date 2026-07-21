/**
 * GET /api/accounts/:id/deep-check-status
 *
 * Возвращает последний ProxyDeepCheckLog для аккаунта + флаги stale/leaking
 * для UI (AccountReadinessTab/Badge). Без fullResult — для drill-down есть
 * отдельный endpoint.
 *
 * Permissions: canRead — это просмотр истории, не запуск check'а.
 */

import { prisma } from "~~/server/utils/prisma"
import type {
  AccountDeepCheckStatus,
  DeepProxyCheckLogSummary,
} from "~~/shared/types/deep-proxy-check"

const STALE_DAYS = 7

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const idRaw = getRouterParam(event, "id")
  const id = Number(idRaw)
  if (!idRaw || !Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID аккаунта" })
  }

  const last = await prisma.proxyDeepCheckLog.findFirst({
    where: { socialAccountId: id },
    orderBy: { createdAt: "desc" },
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

  if (!last) {
    const status: AccountDeepCheckStatus = { last: null, stale: true, leaking: false }
    return { data: status }
  }

  const ageMs = Date.now() - last.createdAt.getTime()
  const stale = ageMs > STALE_DAYS * 24 * 60 * 60 * 1000
  const leaking = last.isLeaking === true

  const summary: DeepProxyCheckLogSummary = {
    ...last,
    startedAt: last.startedAt.toISOString(),
    finishedAt: last.finishedAt?.toISOString() ?? null,
    createdAt: last.createdAt.toISOString(),
  }

  const status: AccountDeepCheckStatus = { last: summary, stale, leaking }
  return { data: status }
})
