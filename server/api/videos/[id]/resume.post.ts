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

  if (video.status === "completed") {
    throw createError({ statusCode: 400, message: "Видео уже сгенерировано" })
  }

  const resumableStatuses = ["failed", "canceled"]
  if (!resumableStatuses.includes(video.status)) {
    throw createError({
      statusCode: 400,
      message: `Нельзя возобновить видео в статусе '${video.status}'. Допустимые: ${resumableStatuses.join(", ")}`,
    })
  }

  await resumeVideoPipeline(id)

  return {
    data: { id, status: "pending", resumed: true },
  }
})
