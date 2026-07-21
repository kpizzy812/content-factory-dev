/**
 * POST /api/trendwatcher/runs/:id/retry
 * Повторный запуск на основе failed/canceled run.
 * Создаёт новый run с тем же profileId.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "trendwatcher",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id запуска" })
  }

  const originalRun = await prisma.trendwatcherRun.findUnique({
    where: { id },
    select: { id: true, status: true, profileId: true, canRetry: true, needsProfileFix: true },
  })

  if (!originalRun) {
    throw createError({ statusCode: 404, message: "Запуск не найден" })
  }

  const terminalStatuses = ["failed", "canceled", "partially_completed"]
  if (!terminalStatuses.includes(originalRun.status)) {
    throw createError({
      statusCode: 400,
      message: `Повтор возможен только для завершённых запусков (текущий статус: ${originalRun.status})`,
    })
  }

  // Блокируем retry, если предыдущий запуск указал на необходимость исправления профиля
  if (originalRun.needsProfileFix) {
    throw createError({
      statusCode: 422,
      message: "Повтор невозможен — предыдущий запуск выявил ошибку конфигурации профиля. Исправьте профиль и запустите заново.",
    })
  }

  // Защита от двойного запуска
  if (hasActiveRun(originalRun.profileId)) {
    const existingRunId = getActiveRunId(originalRun.profileId)
    throw createError({
      statusCode: 409,
      message: `Профиль уже имеет активный запуск #${existingRunId}`,
    })
  }

  const profile = await prisma.trendwatcherProfile.findUnique({
    where: { id: originalRun.profileId },
  })

  if (!profile || !profile.enabled) {
    throw createError({
      statusCode: 400,
      message: "Профиль не найден или отключён — повтор невозможен",
    })
  }

  const newRun = await prisma.trendwatcherRun.create({
    data: {
      profileId: originalRun.profileId,
      status: "pending",
      triggerType: "manual",
      initiatedBy: "operator (retry)",
      sourceType: profile.actorId,
    },
  })

  executeTrendwatcherRun({ runId: newRun.id, profileId: originalRun.profileId }).catch(() => {})

  return {
    data: {
      runId: newRun.id,
      originalRunId: id,
      profileId: originalRun.profileId,
      status: "pending",
    },
  }
})
