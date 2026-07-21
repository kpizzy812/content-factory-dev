/**
 * PUT /api/admin/telegram/chats/:id
 * Обновление настроек чата: алерты, авторизация, routing.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID" })
  }

  const body = await readBody<{
    alertsEnabled?: boolean
    isAuthorized?: boolean
    routingTags?: string[]
  }>(event)

  const existing = await prisma.telegramChat.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Чат не найден" })
  }

  const updated = await prisma.telegramChat.update({
    where: { id },
    data: {
      alertsEnabled: body.alertsEnabled ?? undefined,
      isAuthorized: body.isAuthorized ?? undefined,
      routingTags: body.routingTags ?? undefined,
    },
  })

  return { data: updated }
})
