/**
 * PUT /api/admin/users/:id
 *
 * MarketingCamp — единственный источник истины для прав, ролей, модулей и приложений.
 * Все RBAC-поля (rolePreset, canRead/canWrite/..., moduleAccess, appAssignments)
 * перезатираются при каждом логине через /api/auth/login. Локально править их
 * бессмысленно — изменения откатятся при следующем входе пользователя.
 *
 * Этот endpoint управляет только локальной активностью аккаунта в ZavodCamp:
 * isActive=false блокирует доступ к ZC даже при валидной MC сессии (защита на случай
 * когда нужно срочно отрубить юзера а MC роль ещё не отозвана).
 */
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
  })

  return { data: user }
})
