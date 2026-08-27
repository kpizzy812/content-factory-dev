export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Некорректный ID видео",
    })
  }

  const video = await prisma.video.findUnique({ where: { id } })

  if (!video) {
    throw createError({ statusCode: 404, message: "Видео не найдено" })
  }

  // Список переехал в video-pipeline-run-policy.ts вместе с объяснением, почему
  // `awaiting_operator` в нём есть, а в возобновляемых — нет. Инлайн его держать
  // нельзя: тестом отсюда до него не дотянуться без поднятого Nuxt, а ролик в
  // ожидании без права на отмену запирается навсегда.
  if (!CANCELABLE_VIDEO_STATUSES.includes(video.status)) {
    throw createError({
      statusCode: 400,
      message: `Нельзя отменить видео в статусе '${video.status}'`,
    })
  }

  await cancelVideoPipeline(id)

  return {
    data: { id, status: "canceled", canceled: true },
  }
})
