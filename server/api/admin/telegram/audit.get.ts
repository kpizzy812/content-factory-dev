/**
 * GET /api/admin/telegram/audit
 * Аудит команд Telegram-бота.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const query = getQuery(event) as {
    page?: string
    limit?: string
    command?: string
    resultStatus?: string
  }

  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {}
  if (query.command) where.command = query.command
  if (query.resultStatus) where.resultStatus = query.resultStatus

  const [items, total] = await Promise.all([
    prisma.telegramCommandAudit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        chat: { select: { title: true, username: true, chatType: true } },
      },
    }),
    prisma.telegramCommandAudit.count({ where }),
  ])

  return {
    data: items,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
})
