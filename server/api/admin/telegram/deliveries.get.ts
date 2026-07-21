/**
 * GET /api/admin/telegram/deliveries
 * История отправленных сообщений с пагинацией и фильтрацией.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const query = getQuery(event) as {
    page?: string
    limit?: string
    status?: string
    eventType?: string
  }

  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {}
  if (query.status) where.status = query.status
  if (query.eventType) where.eventType = query.eventType

  const [items, total] = await Promise.all([
    prisma.telegramDelivery.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        template: { select: { id: true, key: true, title: true } },
        chat: { select: { title: true, username: true, chatType: true } },
      },
    }),
    prisma.telegramDelivery.count({ where }),
  ])

  return {
    data: items,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
})
