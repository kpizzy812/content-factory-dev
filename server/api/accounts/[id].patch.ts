/**
 * PATCH /api/accounts/:id
 *
 * Частичное обновление социального аккаунта. Пока единственное поле —
 * `platformHandle` (@-handle канала). Нужен для best-effort захвата URL поста:
 * youtube-post-url.ts фетчит youtube.com/@<handle>/shorts и достаёт videoId.
 * Локальное ZC-поле (НЕ RBAC, не управляется MarketingCamp).
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ["canWrite"], moduleSlug: "social-upload" })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID аккаунта" })
  }

  const body = await readBody<{ platformHandle?: unknown }>(event)
  const data: { platformHandle?: string | null } = {}
  if (body && "platformHandle" in body) {
    if (body.platformHandle === null || body.platformHandle === "") {
      data.platformHandle = null
    } else if (typeof body.platformHandle === "string") {
      // Нормализуем: срезаем ведущий @ и пробелы. Хранится без @.
      data.platformHandle = body.platformHandle.trim().replace(/^@+/, "")
    } else {
      throw createError({ statusCode: 400, message: "platformHandle должен быть строкой или null" })
    }
  }

  if (Object.keys(data).length === 0) {
    throw createError({ statusCode: 400, message: "Нет полей для обновления (ожидается platformHandle)" })
  }

  const account = await prisma.socialAccount.findUnique({ where: { id }, select: { id: true } })
  if (!account) {
    throw createError({ statusCode: 404, message: "Аккаунт не найден" })
  }

  const updated = await prisma.socialAccount.update({
    where: { id },
    data,
    select: { id: true, displayName: true, platformHandle: true },
  })

  return { data: updated }
})
