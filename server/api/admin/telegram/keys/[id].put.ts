/**
 * PUT /api/admin/telegram/keys/:id
 * Обновление API-ключа (label, isActive).
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID" })
  }

  const body = await readBody<{
    label?: string
    isActive?: boolean
  }>(event)

  const existing = await prisma.telegramApiKey.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "API-ключ не найден" })
  }

  const updated = await prisma.telegramApiKey.update({
    where: { id },
    data: {
      label: body.label?.trim() ?? undefined,
      isActive: body.isActive ?? undefined,
    },
  })

  return { data: updated }
})
