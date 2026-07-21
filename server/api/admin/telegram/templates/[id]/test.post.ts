/**
 * POST /api/admin/telegram/templates/:id/test
 * Тестовая отправка шаблона с подстановкой переменных.
 */

import { sendTemplateAlert } from "../../../../../utils/telegram/alerts"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID" })
  }

  const body = await readBody<{
    variables?: Record<string, string>
  }>(event)

  const template = await prisma.telegramMessageTemplate.findUnique({ where: { id } })
  if (!template) {
    throw createError({ statusCode: 404, message: "Шаблон не найден" })
  }

  const result = await sendTemplateAlert(template.key, body?.variables ?? {})

  return { data: result }
})
