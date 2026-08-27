/**
 * POST /api/videos/[id]/shots/[order]/rerender
 *
 * Перегенерация ОДНОГО кадра плана монтажа (§12, план C Task 7): фон этого
 * кадра снимается заново, кадр пересобирается, ролик пересобирается — и всё.
 *
 * Соседние кадры остаются оплаченными: их ассеты и собранные файлы не
 * трогаются, а шаг фонов переиспользует их бесплатно по отпечатку НА КАДР.
 * Речь, транскрипция и lip-sync тоже не трогаются — это перерисовка картинки,
 * а не переозвучка (в отличие от `rerun-step`, который сбрасывает всё вниз по
 * маршруту от указанного шага).
 *
 * План кадра (`background`, `idea`, границы) не меняется: его решает
 * `edit_plan`. Чтобы получить ДРУГУЮ идею фона, оператор правит план и
 * перезапускает `edit_plan`.
 */

import { resetSingleShot, runVideoPipeline } from '~~/server/utils/video-pipeline'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID видео' })
  }

  const orderRaw = getRouterParam(event, 'order')
  const order = Number(orderRaw)
  if (!Number.isInteger(order) || order < 0) {
    throw createError({ statusCode: 400, message: 'Некорректный номер кадра' })
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
      message: `Перегенерация кадра недоступна в статусе '${video.status}'`,
    })
  }

  const shot = await prisma.videoShot.findFirst({
    where: { videoId: id, order },
    select: { id: true },
  })
  if (!shot) {
    throw createError({ statusCode: 404, message: `Кадр ${order} у видео ${id} не найден` })
  }

  await resetSingleShot(id, order)

  // Статус ролика возвращается в очередь тем же способом, что и у перезапуска
  // шага: без этого прогон не стартует, а `filePath`/`fileUrl` продолжали бы
  // указывать на ролик со старым кадром.
  await updateVideoStatus(id, 'pending', {
    errorMessage: null,
    finishedAt: null,
    filePath: null,
    fileUrl: null,
  })

  runVideoPipeline(id).catch((err) => {
    logAgent('video-pipeline', 'error',
      `Ошибка перегенерации кадра ${order} видео ${id}: ${err instanceof Error ? err.message : err}`,
      { videoId: id },
    ).catch(() => {})
  })

  return {
    data: {
      id,
      order,
      status: 'pending',
    },
  }
})
