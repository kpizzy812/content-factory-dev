/**
 * POST /api/admin/apps/:id/enrich
 * Запуск обогащения приложения по store URL.
 */
import { runAppEnrichmentPipeline } from '~~/server/utils/app-enrichment-pipeline'

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID приложения" })
  }

  const body = await readBody(event)
  const storeUrl = body?.storeUrl

  if (!storeUrl || typeof storeUrl !== 'string' || storeUrl.trim().length === 0) {
    throw createError({ statusCode: 400, message: "Store URL обязателен" })
  }

  const result = await runAppEnrichmentPipeline({
    appId: id,
    storeUrl: storeUrl.trim(),
  })

  // Возвращаем обновлённое приложение вместе с результатом
  const updatedApp = await prisma.app.findUnique({
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
        take: 5,
      },
    },
  })

  return { data: updatedApp, enrichResult: result }
})
