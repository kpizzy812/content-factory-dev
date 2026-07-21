/**
 * GET /api/trendwatcher/runs/active
 * Все активные запуски (pending, starting, running, importing, analyzing).
 * Используется для polling UI — быстрый endpoint без пагинации.
 */

import type { TrendwatcherRunStatus } from "../../../../app/generated/prisma/client"

const ACTIVE_STATUSES: TrendwatcherRunStatus[] = ["pending", "starting", "running", "importing", "analyzing"]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "trendwatcher",
  })

  const runs = await prisma.trendwatcherRun.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    include: {
      profile: { select: { id: true, name: true, actorId: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 50,
  })

  return { data: runs }
})
