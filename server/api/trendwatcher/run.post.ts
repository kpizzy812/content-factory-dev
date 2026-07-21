/**
 * POST /api/trendwatcher/run
 * Запуск Apify-парсинга по profileId.
 * Асинхронный fire-and-forget: создаёт TrendwatcherRun в БД и запускает фоновое выполнение.
 * Не блокирует HTTP-запрос — сразу возвращает runId и статус pending.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "trendwatcher",
  })

  const body = await readBody<{ profileId?: number }>(event)

  if (!body?.profileId || typeof body.profileId !== "number" || body.profileId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'profileId' обязательно и должно быть числом > 0",
    })
  }

  const profile = await prisma.trendwatcherProfile.findUnique({
    where: { id: body.profileId },
  })

  if (!profile) {
    throw createError({
      statusCode: 404,
      message: "Профиль парсинга не найден",
    })
  }

  if (!profile.enabled) {
    throw createError({
      statusCode: 400,
      message: "Профиль парсинга отключен",
    })
  }

  if (profile.keywords.length === 0) {
    throw createError({
      statusCode: 400,
      message: "Профиль не содержит ключевых слов для парсинга",
    })
  }

  // Блокируем запуск, если профиль имеет известную невалидную конфигурацию
  // (требует fix, а не просто retry)
  const invalidStatuses = ["actor_not_found", "token_missing", "profile_invalid", "actor_input_invalid"]
  if (profile.validationStatus && invalidStatuses.includes(profile.validationStatus)) {
    throw createError({
      statusCode: 422,
      message: `Профиль не прошёл валидацию: ${profile.validationSummary ?? profile.validationStatus}. Исправьте конфигурацию или выполните повторную валидацию.`,
    })
  }

  // Защита от двойного запуска
  if (hasActiveRun(body.profileId)) {
    const existingRunId = getActiveRunId(body.profileId)
    throw createError({
      statusCode: 409,
      message: `Профиль уже имеет активный запуск #${existingRunId}`,
    })
  }

  // Создаём запись запуска в БД
  const run = await prisma.trendwatcherRun.create({
    data: {
      profileId: body.profileId,
      status: "pending",
      triggerType: "manual",
      initiatedBy: "operator",
      sourceType: profile.actorId,
    },
  })

  // Fire-and-forget: не блокируем HTTP-ответ
  executeTrendwatcherRun({ runId: run.id, profileId: body.profileId }).catch(() => {})

  return {
    data: {
      runId: run.id,
      profileId: body.profileId,
      status: "pending",
    },
  }
})
