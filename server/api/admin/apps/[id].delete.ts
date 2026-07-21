/**
 * DELETE /api/admin/apps/:id
 * Удаление приложения (только если нет связанных данных).
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID приложения" })
  }

  const existing = await prisma.app.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Приложение не найдено" })
  }

  const [trendsCount, accountsCount, cyclesCount] = await Promise.all([
    prisma.trend.count({ where: { appId: id } }),
    prisma.socialAccount.count({ where: { appId: id } }),
    prisma.productionCycle.count({ where: { appId: id } }),
  ])

  if (trendsCount > 0 || accountsCount > 0 || cyclesCount > 0) {
    throw createError({
      statusCode: 409,
      message: `Невозможно удалить: у приложения есть связанные данные (тренды: ${trendsCount}, аккаунты: ${accountsCount}, циклы: ${cyclesCount})`,
    })
  }

  await prisma.app.delete({ where: { id } })

  return { data: { id, deleted: true } }
})
