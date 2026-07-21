/**
 * POST /api/admin/telegram/deliveries/:id/resend
 * Повторная отправка failed-доставки.
 */

import { sendMessage } from "../../../../../utils/telegram/messaging"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID" })
  }

  const delivery = await prisma.telegramDelivery.findUnique({ where: { id } })
  if (!delivery) {
    throw createError({ statusCode: 404, message: "Доставка не найдена" })
  }

  if (delivery.status === "sent") {
    throw createError({ statusCode: 400, message: "Сообщение уже было доставлено" })
  }

  if (!delivery.messageText) {
    throw createError({ statusCode: 400, message: "Текст сообщения отсутствует — повтор невозможен" })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || ""
  if (!token) {
    throw createError({ statusCode: 400, message: "TELEGRAM_BOT_TOKEN не настроен" })
  }

  const result = await sendMessage(token, delivery.targetChatId, delivery.messageText)

  await prisma.telegramDelivery.update({
    where: { id },
    data: {
      status: result.success ? "sent" : "failed",
      telegramMessageId: result.messageId,
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
})
