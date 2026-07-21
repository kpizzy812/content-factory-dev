/**
 * GET /api/admin/cycles/:id
 * Детали цикла с логами.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canRead")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID цикла" })
  }

  const cycle = await prisma.productionCycle.findUnique({
    where: { id },
    include: {
      app: { select: { id: true, name: true } },
      accountGroup: { select: { id: true, name: true } },
      logs: {
        orderBy: { createdAt: "asc" },
        take: 100,
      },
    },
  })

  if (!cycle) {
    throw createError({ statusCode: 404, message: "Цикл не найден" })
  }

  return { data: cycle }
})
