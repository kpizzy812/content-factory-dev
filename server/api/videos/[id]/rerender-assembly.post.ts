/**
 * POST /api/videos/[id]/rerender-assembly
 *
 * Перезапустить только шаг assembly без перегенерации clip/image/voiceover.
 * Используется когда оператор хочет применить уже сохранённые изменения
 * (Video.subtitlesStyle, subtitlePreset, storyPlan.scenes[].subtitleCopy)
 * без перерасхода API на Kling/FLUX/TTS.
 *
 * Отличие от edit-subtitles: edit-subtitles обновляет данные И триггерит rerun.
 * Этот endpoint — только rerun, без правок (например, после ручной отладки в БД).
 */

import { rerunVideoStep } from '~~/server/utils/video-pipeline'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID видео' })
  }

  const video = await prisma.video.findUnique({
    where: { id },
    select: { id: true, status: true, isLocked: true },
  })
  if (!video) {
    throw createError({ statusCode: 404, message: 'Видео не найдено' })
  }
  if (video.isLocked) {
    throw createError({ statusCode: 409, message: 'Видео заблокировано — идёт другая операция' })
  }
  if (video.status !== 'completed' && video.status !== 'failed' && video.status !== 'canceled') {
    throw createError({
      statusCode: 400,
      message: `Пересборка assembly недоступна в статусе '${video.status}'`,
    })
  }

  await rerunVideoStep(id, 'assembly')

  return {
    data: {
      id,
      rerunFrom: 'assembly',
      status: 'pending',
    },
  }
})
