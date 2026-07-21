/**
 * DELETE /api/admin/telegram/templates/:id
 * Удаление шаблона сообщения.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID" })
  }

  const existing = await prisma.telegramMessageTemplate.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Шаблон не найден" })
  }

  await prisma.telegramMessageTemplate.delete({ where: { id } })

  return { data: { success: true } }
})
