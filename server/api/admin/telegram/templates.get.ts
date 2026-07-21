/**
 * GET /api/admin/telegram/templates
 * Список шаблонов сообщений.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const templates = await prisma.telegramMessageTemplate.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { deliveries: true },
      },
    },
  })

  return { data: templates }
})
