/**
 * GET /api/admin/cycles
 * Список циклов с фильтрами и пагинацией.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canRead")

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20))
  const offset = (page - 1) * limit

  const where: Record<string, unknown> = {}

  if (query.status && typeof query.status === "string") {
    where.status = query.status
  }
  if (query.appId) {
    const appId = Number(query.appId)
    if (!isNaN(appId)) where.appId = appId
  }

  const [cycles, total] = await Promise.all([
    prisma.productionCycle.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        app: { select: { id: true, name: true } },
      },
    }),
    prisma.productionCycle.count({ where }),
  ])

  return {
    data: cycles,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
})
