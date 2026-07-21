import { randomBytes } from "node:crypto"

/**
 * POST /api/admin/telegram/keys/:id/rotate
 * Ротация API-ключа: генерирует новое значение ключа, сбрасывает lastUsedAt.
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

  const newKey = `tgk_${randomBytes(24).toString("hex")}`

  const updated = await prisma.telegramApiKey.update({
    where: { id },
    data: {
      key: newKey,
      lastUsedAt: null,
    },
  })

  return { data: updated }
})
