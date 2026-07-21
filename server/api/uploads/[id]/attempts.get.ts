/**
 * GET /api/uploads/:id/attempts
 * История попыток загрузки.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'social-upload' })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Неверный ID загрузки",
    })
  }

  const upload = await prisma.upload.findUnique({
    where: { id },
    select: { id: true },
  })

  if (!upload) {
    throw createError({ statusCode: 404, message: "Загрузка не найдена" })
  }

  const attempts = await prisma.socialUploadAttempt.findMany({
    where: { uploadId: id },
    orderBy: { attemptNumber: "desc" },
  })

  return { data: attempts }
})
