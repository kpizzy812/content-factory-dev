/**
 * POST /api/admin/telegram/templates
 * Создание нового шаблона сообщения.
 * Валидирует переменные по canonical registry.
 */

import { validateTemplateBody } from "~~/server/utils/telegram/variable-registry"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const body = await readBody<{
    key: string
    title: string
    category?: string
    messageBody: string
    variablesSchema?: Record<string, string>
    isActive?: boolean
  }>(event)

  if (!body?.key || !body.title || !body.messageBody) {
    throw createError({
      statusCode: 400,
      message: "Поля key, title и messageBody обязательны",
    })
  }

  // Проверка уникальности ключа
  const existing = await prisma.telegramMessageTemplate.findUnique({
    where: { key: body.key },
  })
  if (existing) {
    throw createError({ statusCode: 409, message: `Шаблон с ключом '${body.key}' уже существует` })
  }

  // Валидация переменных по registry
  const validation = validateTemplateBody(body.messageBody)

  const template = await prisma.telegramMessageTemplate.create({
    data: {
      key: body.key,
      title: body.title,
      category: body.category ?? "alert",
      messageBody: body.messageBody,
      variablesSchema: body.variablesSchema ?? undefined,
      isActive: body.isActive ?? true,
    },
  })

  return {
    data: template,
    validation: validation.invalid.length > 0 || validation.unsupportedExpressions.length > 0
      ? {
          invalidVariables: validation.invalid,
          unsupportedExpressions: validation.unsupportedExpressions,
        }
      : undefined,
  }
})
