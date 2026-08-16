const VALID_STEPS = ["prompt_generation", "image_generation", "clip_generation", "music_generation", "assembly", "transcription"] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Некорректный ID видео",
    })
  }

  const body = await readBody<{ stepKey?: string }>(event)
  const stepKey = body?.stepKey

  if (!stepKey || !VALID_STEPS.includes(stepKey as typeof VALID_STEPS[number])) {
    throw createError({
      statusCode: 400,
      message: `Поле 'stepKey' обязательно и должно быть одним из: ${VALID_STEPS.join(", ")}`,
    })
  }

  const video = await prisma.video.findUnique({ where: { id } })

  if (!video) {
    throw createError({ statusCode: 404, message: "Видео не найдено" })
  }

  if (video.isLocked) {
    throw createError({
      statusCode: 409,
      message: "Pipeline уже запущен. Дождитесь завершения или отмените текущий запуск.",
    })
  }

  const rerunableStatuses = ["failed", "canceled", "completed"]
  if (!rerunableStatuses.includes(video.status)) {
    throw createError({
      statusCode: 400,
      message: `Нельзя перезапустить шаг для видео в статусе '${video.status}'`,
    })
  }

  // Посчитать, какие шаги будут сброшены
  const stepIndex = VALID_STEPS.indexOf(stepKey as typeof VALID_STEPS[number])
  const affectedSteps = VALID_STEPS.slice(stepIndex)
  const preservedSteps = VALID_STEPS.slice(0, stepIndex)

  await rerunVideoStep(id, stepKey as typeof VALID_STEPS[number])

  return {
    data: {
      id,
      rerunFrom: stepKey,
      affectedSteps,
      preservedSteps,
      status: "pending",
    },
  }
})
