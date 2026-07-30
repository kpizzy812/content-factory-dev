/**
 * PUT /api/admin/users/:id
 *
 * При AUTH_PROVIDER=marketingcamp родительская платформа остаётся источником истины
 * для прав, ролей, модулей и приложений: все RBAC-поля перезатираются при каждом
 * логине через /api/auth/login, поэтому локально править их бессмысленно.
 *
 * Этот endpoint управляет только локальной активностью аккаунта:
 * isActive=false блокирует доступ даже при валидной внешней сессии (защита на случай
 * когда нужно срочно отрубить юзера, а роль во внешней платформе ещё не отозвана).
 * Пароль локальной учётки меняется отдельным endpoint'ом /api/admin/users/:id/password.
 */
import { PUBLIC_USER_SELECT } from "~~/server/utils/auth/user-select"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID пользователя" })
  }

  const existing = await prisma.zavodUser.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Пользователь не найден" })
  }

  const body = await readBody(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  if (typeof body.isActive !== "boolean") {
    throw createError({
      statusCode: 400,
      message: "Только поле isActive можно менять локально. Права/роли управляются в MarketingCamp.",
    })
  }

  const user = await prisma.zavodUser.update({
    where: { id },
    data: { isActive: body.isActive },
    select: PUBLIC_USER_SELECT,
  })

  return { data: user }
})
