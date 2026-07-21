/**
 * PUT /api/admin/logs/:id/resolve
 * Пометить лог как разрешенный.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canWrite")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID лога" })
  }

  const log = await prisma.agentLog.findUnique({ where: { id } })
  if (!log) {
    throw createError({ statusCode: 404, message: "Лог не найден" })
  }

  if (log.resolved) {
    return { data: log }
  }

  const updated = await prisma.agentLog.update({
    where: { id },
    data: { resolved: true },
  })

  return { data: updated }
})
