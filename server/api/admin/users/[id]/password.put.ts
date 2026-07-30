/**
 * PUT /api/admin/users/:id/password
 * Назначение или смена локального пароля. Используется и при переводе установки
 * с MarketingCamp на локальную авторизацию.
 */
import { assertPasswordPolicy, hashPassword } from "~~/server/utils/auth/password"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, message: "Некорректный id" })

  const body = await readBody<{ password?: string }>(event)
  if (!body?.password) throw createError({ statusCode: 400, message: "Пароль обязателен" })
  assertPasswordPolicy(body.password)

  const user = await prisma.zavodUser.findUnique({ where: { id }, select: { id: true } })
  if (!user) throw createError({ statusCode: 404, message: "Пользователь не найден" })

  await prisma.zavodUser.update({
    where: { id },
    data: { passwordHash: await hashPassword(body.password) },
  })

  return { data: { ok: true } }
})
