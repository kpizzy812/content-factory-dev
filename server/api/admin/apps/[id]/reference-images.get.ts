/**
 * GET /api/admin/apps/:id/reference-images
 * Возвращает все AppReferenceImage записи приложения с AI-метаданными.
 * Используется UI-менеджером для polling статуса AI-анализа.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID приложения" })
  }

  const app = await prisma.app.findUnique({
    where: { id },
    select: { id: true, referenceImageUrls: true },
  })
  if (!app) {
    throw createError({ statusCode: 404, message: "Приложение не найдено" })
  }

  const referenceImages = await prisma.appReferenceImage.findMany({
    where: { appId: id },
    orderBy: { createdAt: "desc" },
  })

  return {
    data: {
      referenceImageUrls: app.referenceImageUrls,
      referenceImages,
    },
  }
})
