/**
 * DELETE /api/admin/telegram/chats/:id
 * Удаление привязки чата.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID" })
  }

  const existing = await prisma.telegramChat.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Чат не найден" })
  }

  // Отвязываем пользователя, если есть
  if (existing.userId) {
    await prisma.zavodUser.updateMany({
      where: { telegramChatId: existing.chatId },
      data: { telegramChatId: null },
    }).catch(() => {})
  }

  await prisma.telegramChat.delete({ where: { id } })

  return { data: { success: true } }
})
