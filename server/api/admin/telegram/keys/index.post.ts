import { randomBytes } from "node:crypto"

/**
 * POST /api/admin/telegram/keys
 * Генерация нового API-ключа для Telegram-интеграции.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const body = await readBody<{
    label: string
    expiresAt?: string
  }>(event)

  if (!body?.label?.trim()) {
    throw createError({
      statusCode: 400,
      message: "Поле label обязательно",
    })
  }

  const key = `tgk_${randomBytes(24).toString("hex")}`

  const created = await prisma.telegramApiKey.create({
    data: {
      key,
      label: body.label.trim(),
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
  })

  return { data: created }
})
