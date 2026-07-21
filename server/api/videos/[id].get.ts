export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Некорректный ID видео",
    })
  }

  const video = await prisma.video.findUnique({
    where: { id },
    include: {
      assets: {
        orderBy: { order: "asc" },
      },
      scenario: {
        select: {
          id: true,
          trendId: true,
          selectedVariantId: true,
          variants: {
            where: { status: 'accepted' },
            select: {
              id: true,
              title: true,
              hook: true,
              body: true,
              cta: true,
              visualStyleText: true,
              // storyPlan нужен для редактирования субтитров per-scene в UI
              storyPlan: true,
            },
            take: 1,
          },
        },
      },
    },
  })

  if (!video) {
    throw createError({
      statusCode: 404,
      message: "Видео не найдено",
    })
  }

  return { data: video }
})
