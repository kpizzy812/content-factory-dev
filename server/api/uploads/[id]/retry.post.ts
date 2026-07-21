/**
 * POST /api/uploads/:id/retry
 * Повторить загрузку (для failed или blocked_by_env).
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'social-upload' })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Неверный ID загрузки",
    })
  }

  const upload = await prisma.upload.findUnique({
    where: { id },
    select: { id: true, status: true },
  })

  if (!upload) {
    throw createError({ statusCode: 404, message: "Загрузка не найдена" })
  }

  const retryableStatuses = ["failed", "blocked_by_env"]
  if (!retryableStatuses.includes(upload.status)) {
    throw createError({
      statusCode: 400,
      message: `Повторить можно только загрузку со статусом ${retryableStatuses.join("/")}. Текущий: ${upload.status}`,
    })
  }

  // Проверить env guard перед retry
  if (process.env.ENABLE_SOCIAL_POSTING !== "true") {
    throw createError({
      statusCode: 403,
      message: "Публикация в соцсети отключена (ENABLE_SOCIAL_POSTING=false). Включите перед повторной загрузкой.",
    })
  }

  // Сбросить статус и ошибку
  await prisma.upload.update({
    where: { id },
    data: {
      status: "pending" as never,
      errorMessage: null,
      platformPostId: null,
      platformPostUrl: null,
      blockedByEnv: false,
    },
  })

  // Fire-and-forget: запустить pipeline
  runUploadPipeline(id).catch(() => {})

  return { data: { id, status: "pending", retrying: true } }
})
