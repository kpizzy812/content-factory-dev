/**
 * DELETE /api/admin/telegram/keys/:id
 * Удаление API-ключа.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID" })
  }

  const existing = await prisma.telegramApiKey.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "API-ключ не найден" })
  }

  await prisma.telegramApiKey.delete({ where: { id } })

  return { data: { success: true } }
})
