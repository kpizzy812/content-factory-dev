/**
 * GET /api/admin/apps/:id
 * Получение одного приложения со всеми полями и логами обогащения.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID приложения" })
  }

  const app = await prisma.app.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          trends: true,
          socialAccounts: true,
          cycles: true,
        },
      },
      enrichmentLogs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  })

  if (!app) {
    throw createError({ statusCode: 404, message: "Приложение не найдено" })
  }

  return { data: app }
})
