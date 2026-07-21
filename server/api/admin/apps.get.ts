/**
 * GET /api/admin/apps
 * Список приложений с подсчетом связанных данных.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const apps = await prisma.app.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          trends: true,
          socialAccounts: true,
          cycles: true,
        },
      },
    },
  })

  return { data: apps }
})
