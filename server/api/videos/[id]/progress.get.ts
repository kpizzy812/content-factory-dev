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
    select: {
      id: true,
      status: true,
      currentStep: true,
      errorMessage: true,
      format: true,
      isLocked: true,
      startedAt: true,
      finishedAt: true,
      subtitlesEnabled: true,
      musicEnabled: true,
      musicMood: true,
      renderQuality: true,
      targetPlatform: true,
      totalCostEstimate: true,
      totalCostActual: true,
      assets: {
        select: {
          id: true,
          type: true,
          prompt: true,
          fileUrl: true,
          order: true,
        },
        orderBy: { order: "asc" },
      },
      steps: {
        select: {
          id: true,
          stepKey: true,
          stepIndex: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          attemptCount: true,
          estimatedCost: true,
          actualCost: true,
          logs: true,
          errorMessage: true,
          inputSnapshot: true,
          outputSnapshot: true,
          falRequestId: true,
          falEndpoint: true,
          falQueueStatus: true,
          falLogsSnapshot: true,
          falSubmittedAt: true,
          falCompletedAt: true,
          falCanceledAt: true,
        },
        orderBy: { stepIndex: "asc" },
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
