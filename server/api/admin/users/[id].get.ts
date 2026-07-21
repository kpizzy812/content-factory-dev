/**
 * GET /api/admin/users/:id
 * Детальная информация о пользователе.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID пользователя" })
  }

  const user = await prisma.zavodUser.findUnique({
    where: { id },
    include: { appAssignments: true },
  })

  if (!user) {
    throw createError({ statusCode: 404, message: "Пользователь не найден" })
  }

  return { data: user }
})
