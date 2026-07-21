/**
 * POST /api/admin/cycles/:id/stop
 * Остановка производственного цикла.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canRunAgent")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID цикла" })
  }

  const cycle = await prisma.productionCycle.findUnique({ where: { id } })
  if (!cycle) {
    throw createError({ statusCode: 404, message: "Цикл не найден" })
  }

  if (cycle.status !== "running" && cycle.status !== "pending") {
    throw createError({
      statusCode: 409,
      message: `Невозможно остановить цикл в статусе: ${cycle.status}`,
    })
  }

  const updated = await prisma.productionCycle.update({
    where: { id },
    data: {
      status: "stopped",
      completedAt: new Date(),
    },
  })

  await logAgent("orchestrator", "warn", `Цикл #${id} остановлен вручную`, { cycleId: id }, id)

  return { data: updated }
})
