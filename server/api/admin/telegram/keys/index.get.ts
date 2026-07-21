/**
 * GET /api/admin/telegram/keys
 * Список всех API-ключей Telegram.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const keys = await prisma.telegramApiKey.findMany({
    orderBy: { createdAt: "desc" },
  })

  return { data: keys }
})
