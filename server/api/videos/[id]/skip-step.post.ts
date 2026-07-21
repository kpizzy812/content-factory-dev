import { STEP_ORDER, type VideoStepKey } from "~~/shared/types/video"

/**
 * Пропуск опционального шага видео-пайплайна.
 *
 * Whitelist: voiceover_generation, music_generation. Критичные шаги
 * (prompt/image/clip/assembly) пропускать нельзя — без них видео не соберётся.
 *
 * Скип отключает соответствующий флаг на Video (voiceoverEnabled / musicEnabled)
 * и помечает VideoGenerationStep как skipped. При следующем /resume runStep
 * увидит !flag и пройдёт early-return со status='skipped'.
 */
const SKIPPABLE_STEPS = {
  voiceover_generation: { flagField: "voiceoverEnabled", reason: "voiceover_disabled_by_config" },
  music_generation: { flagField: "musicEnabled", reason: "music_disabled_by_config" },
} as const

type SkippableStep = keyof typeof SKIPPABLE_STEPS

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ["canRunAgent"], moduleSlug: "video-generator" })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID видео" })
  }

  const body = await readBody<{ stepKey?: string }>(event)
  const stepKey = body?.stepKey as SkippableStep | undefined

  if (!stepKey || !(stepKey in SKIPPABLE_STEPS)) {
    throw createError({
      statusCode: 400,
      message: `Поле 'stepKey' обязательно и должно быть одним из: ${Object.keys(SKIPPABLE_STEPS).join(", ")}`,
    })
  }

  const video = await prisma.video.findUnique({ where: { id } })

  if (!video) {
    throw createError({ statusCode: 404, message: "Видео не найдено" })
  }

  if (video.isLocked) {
    throw createError({
      statusCode: 409,
      message: "Pipeline уже запущен. Сначала отмените генерацию или дождитесь её завершения.",
    })
  }

  const config = SKIPPABLE_STEPS[stepKey]

  // 1) Отключаем флаг на Video — иначе при следующем resume runStep заново
  //    запустит провайдера, увидит skipped step и попытается переписать.
  await prisma.video.update({
    where: { id },
    data: { [config.flagField]: false },
  })

  // 2) Помечаем шаг как skipped. errorMessage очищается, чтобы UI не показывал
  //    устаревшую красную плашку. outputSnapshot оставляем минимальный — runStep
  //    при resume увидит !flag и сам пройдёт early-return.
  const stepRecord = await prisma.videoGenerationStep.findFirst({
    where: { videoId: id, stepKey },
  })

  const skipPayload = {
    status: "skipped" as never,
    finishedAt: new Date(),
    errorMessage: null,
    outputSnapshot: { reason: `manual_skip:${config.reason}` } as never,
  }

  if (stepRecord) {
    await prisma.videoGenerationStep.update({
      where: { id: stepRecord.id },
      data: skipPayload,
    })
  } else {
    // Шаг ещё не создан (resume может его материализовать) — создаём skipped
    // запись наперёд, чтобы UI отрисовал правильный статус.
    const orderIndex = STEP_ORDER.indexOf(stepKey as VideoStepKey)
    await prisma.videoGenerationStep.create({
      data: {
        videoId: id,
        stepKey: stepKey as never,
        order: orderIndex >= 0 ? orderIndex : 0,
        ...skipPayload,
      },
    })
  }

  return {
    data: {
      id,
      stepKey,
      flagField: config.flagField,
      status: "skipped",
    },
  }
})
