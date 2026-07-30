/**
 * GET /api/admin/users/:id
 * Детальная информация о пользователе.
 */
import { PUBLIC_USER_SELECT } from "~~/server/utils/auth/user-select"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID пользователя" })
  }

  const user = await prisma.zavodUser.findUnique({
    where: { id },
    select: { ...PUBLIC_USER_SELECT, appAssignments: true },
  })

  if (!user) {
    throw createError({ statusCode: 404, message: "Пользователь не найден" })
  }

  return { data: user }
})
