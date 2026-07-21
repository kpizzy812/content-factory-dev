/**
 * GET /api/proxies/deep-check-logs/:logId
 *
 * Возвращает полный ProxyDeepCheckLog с fullResult для drill-down модалки.
 *
 * Permissions: canRead — просмотр истории.
 */

import { prisma } from "~~/server/utils/prisma"
import type { DeepProxyCheckLogDetail } from "~~/shared/types/deep-proxy-check"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const logId = getRouterParam(event, "logId")
  if (!logId || typeof logId !== "string") {
    throw createError({ statusCode: 400, message: "Неверный ID лога" })
  }

  const log = await prisma.proxyDeepCheckLog.findUnique({
    where: { id: logId },
  })

  if (!log) {
    throw createError({ statusCode: 404, message: `Лог ${logId} не найден` })
  }

  const data: DeepProxyCheckLogDetail = {
    ...log,
    startedAt: log.startedAt.toISOString(),
    finishedAt: log.finishedAt?.toISOString() ?? null,
    createdAt: log.createdAt.toISOString(),
    fullResult: log.fullResult as DeepProxyCheckLogDetail["fullResult"],
  }

  return { data }
})
