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

  const cancelableStatuses = ["pending", "generating_prompts", "generating_images", "generating_clips", "generating_music", "assembling"]
  if (!cancelableStatuses.includes(video.status)) {
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
