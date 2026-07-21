/**
 * PUT /api/admin/telegram/templates/:id
 * Обновление шаблона сообщения.
 * Валидирует переменные по canonical registry.
 */

import { validateTemplateBody } from "~~/server/utils/telegram/variable-registry"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID" })
  }

  const body = await readBody<{
    title?: string
    category?: string
    messageBody?: string
    variablesSchema?: Record<string, string> | null
    isActive?: boolean
  }>(event)

  const existing = await prisma.telegramMessageTemplate.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Шаблон не найден" })
  }

  // Валидация переменных по registry (если messageBody обновляется)
  const messageBody = body.messageBody ?? existing.messageBody
  const validation = validateTemplateBody(messageBody)

  const updated = await prisma.telegramMessageTemplate.update({
    where: { id },
    data: {
      title: body.title ?? undefined,
      category: body.category ?? undefined,
      messageBody: body.messageBody ?? undefined,
      variablesSchema: body.variablesSchema !== undefined ? (body.variablesSchema ?? undefined) : undefined,
      isActive: body.isActive ?? undefined,
    },
  })

  return {
    data: updated,
    validation: validation.invalid.length > 0 || validation.unsupportedExpressions.length > 0
      ? {
          invalidVariables: validation.invalid,
          unsupportedExpressions: validation.unsupportedExpressions,
        }
      : undefined,
  }
})
