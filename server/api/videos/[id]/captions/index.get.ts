/**
 * GET /api/videos/[id]/captions
 *
 * Возвращает все captions для видео (по одному на каждую сгенерированную платформу).
 * Используется на странице /videos/[id] секцией VideoCaptionsSection.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'video-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID видео' })
  }

  const video = await prisma.video.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!video) {
    throw createError({ statusCode: 404, message: 'Видео не найдено' })
  }

  const captions = await prisma.caption.findMany({
    where: { videoId: id },
    orderBy: { platform: 'asc' as const },
  })

  return { data: captions }
})
