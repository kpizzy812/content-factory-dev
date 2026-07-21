/**
 * GET /api/admin/telegram/status
 * Полный статус Telegram-интеграции: бот, health, чаты, последние доставки.
 */

import { getBotHealth } from "../../../utils/telegram/bot"
import { getBotInfo } from "../../../utils/telegram/messaging"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const health = getBotHealth()
  const token = process.env.TELEGRAM_BOT_TOKEN || ""

  // Получаем информацию о боте, если токен есть
  let botInfo: { username?: string; firstName?: string } | null = null
  if (token) {
    const info = await getBotInfo(token)
    if (info.ok) {
      botInfo = { username: info.username, firstName: info.firstName }
    }
  }

  const [chats, totalDeliveries, failedDeliveries, recentDeliveries, lastSuccessfulSend, lastFailedSend] = await Promise.all([
    prisma.telegramChat.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        chatId: true,
        userId: true,
        chatType: true,
        title: true,
        username: true,
        alertsEnabled: true,
        isAuthorized: true,
        routingTags: true,
        createdAt: true,
      },
    }),
    prisma.telegramDelivery.count(),
    prisma.telegramDelivery.count({ where: { status: "failed" } }),
    prisma.telegramDelivery.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        eventType: true,
        status: true,
        targetChatId: true,
        errorMessage: true,
        sentAt: true,
        createdAt: true,
        chat: { select: { title: true, username: true } },
      },
    }),
    prisma.telegramDelivery.findFirst({
      where: { status: "sent" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.telegramDelivery.findFirst({
      where: { status: "failed" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, errorMessage: true },
    }),
  ])

  return {
    data: {
      configured: !!token,
      transportMode: "polling",
      botInfo,
      health: {
        running: health.running,
        lastSuccessfulUpdate: health.lastSuccessfulUpdate,
        lastError: health.lastError,
        lastErrorCategory: health.lastErrorCategory,
        lastSuccessfulSend: lastSuccessfulSend?.sentAt ?? null,
        lastFailedSend: lastFailedSend ? {
          at: lastFailedSend.createdAt,
          error: lastFailedSend.errorMessage,
        } : null,
      },
      chats: {
        total: chats.length,
        alertsEnabled: chats.filter((c: { alertsEnabled: boolean }) => c.alertsEnabled).length,
        items: chats,
      },
      deliveries: {
        total: totalDeliveries,
        failed: failedDeliveries,
        recent: recentDeliveries,
      },
    },
  }
})
