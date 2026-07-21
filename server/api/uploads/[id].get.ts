/**
 * GET /api/uploads/:id
 * Детальная информация о загрузке.
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
    include: {
      socialAccount: {
        select: {
          id: true,
          platform: true,
          displayName: true,
          status: true,
        },
      },
      video: {
        select: {
          id: true,
          status: true,
          format: true,
          fileUrl: true,
          duration: true,
          scenario: {
            select: {
              id: true,
              trendId: true,
            },
          },
        },
      },
      attempts: {
        orderBy: { attemptNumber: "desc" as const },
        take: 10,
      },
    },
  })

  if (!upload) {
    throw createError({ statusCode: 404, message: "Загрузка не найдена" })
  }

  return { data: upload }
})
