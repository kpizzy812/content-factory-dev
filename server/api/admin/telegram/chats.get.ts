/**
 * GET /api/admin/telegram/chats
 * Список подключённых Telegram-чатов с информацией о пользователях.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const chats = await prisma.telegramChat.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          deliveries: true,
          commandAudits: true,
        },
      },
    },
  })

  // Получаем имена пользователей
  const userIds = chats.map((c: { userId: number | null }) => c.userId).filter(Boolean) as number[]
  const users = userIds.length > 0
    ? await prisma.zavodUser.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, surname: true, email: true, rolePreset: true },
      })
    : []

  const userMap = new Map(users.map((u) => [u.id, u]))

  const items = chats.map((chat: any) => ({
    ...chat,
    user: chat.userId ? userMap.get(chat.userId) ?? null : null,
  }))

  return { data: items }
})
