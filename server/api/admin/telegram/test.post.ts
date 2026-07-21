/**
 * POST /api/admin/telegram/test
 * Тестовая отправка: проверка API, отправка в конкретный чат или во все.
 */

import { sendStructuredAlert } from "../../../utils/telegram/alerts"
import { sendMessage, getBotInfo } from "../../../utils/telegram/messaging"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const body = await readBody<{
    action: "test_api" | "test_send" | "test_chat"
    message?: string
    chatId?: string
  }>(event)

  const token = process.env.TELEGRAM_BOT_TOKEN || ""
  if (!token) {
    throw createError({ statusCode: 400, message: "TELEGRAM_BOT_TOKEN не настроен" })
  }

  // Тест API — проверяем что бот работает
  if (body.action === "test_api") {
    const info = await getBotInfo(token)
    return {
      data: {
        success: info.ok,
        botUsername: info.username,
        botName: info.firstName,
        error: info.error,
      },
    }
  }

  // Тест отправки в конкретный чат
  if (body.action === "test_chat") {
    if (!body.chatId) {
      throw createError({ statusCode: 400, message: "chatId обязателен для test_chat" })
    }

    const message = body.message?.trim() || "Тестовое сообщение из админки Контент-Завода"
    const result = await sendMessage(token, body.chatId, `🔍 <b>Тест</b>\n\n${message}`)

    // Записываем доставку
    await prisma.telegramDelivery.create({
      data: {
        eventType: "test",
        targetChatId: body.chatId,
        status: result.success ? "sent" : "failed",
        telegramMessageId: result.messageId,
        messageText: message,
        errorMessage: result.error ?? null,
        sentAt: result.success ? new Date() : null,
      },
    })

    return {
      data: {
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      },
    }
  }

  // Тест рассылки всем
  if (body.action === "test_send") {
    const message = body.message?.trim()
    if (!message) {
      throw createError({ statusCode: 400, message: "message обязателен для test_send" })
    }

    const chatsCount = await prisma.telegramChat.count({ where: { alertsEnabled: true } })
    if (chatsCount === 0) {
      return { data: { sent: false, reason: "Нет чатов с включенными алертами" } }
    }

    await sendStructuredAlert({
      type: "test",
      message: `[ТЕСТ] ${message}`,
    })

    return { data: { sent: true, chatsCount } }
  }

  throw createError({ statusCode: 400, message: "Неизвестный action" })
})
