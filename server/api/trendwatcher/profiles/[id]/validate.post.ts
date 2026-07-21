/**
 * POST /api/trendwatcher/profiles/:id/validate
 * Preflight-валидация профиля: проверяет actorId, token, доступ к актору.
 * Не запускает actor — только проверяет конфигурацию.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "trendwatcher",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id профиля" })
  }

  const profile = await prisma.trendwatcherProfile.findUnique({
    where: { id },
  })

  if (!profile) {
    throw createError({ statusCode: 404, message: "Профиль не найден" })
  }

  const result = await preflightValidateProfile({
    actorId: profile.actorId,
    keywords: profile.keywords,
    enabled: profile.enabled,
    maxItems: profile.maxItems,
  })

  // Persist validation result
  await prisma.trendwatcherProfile.update({
    where: { id },
    data: {
      validationStatus: result.valid ? "valid" : (result.errorCode ?? "profile_invalid"),
      validationSummary: result.valid ? null : (result.errorSummary ?? null),
      validatedAt: new Date(),
    },
  })

  return {
    data: {
      profileId: id,
      ...result,
    },
  }
})
