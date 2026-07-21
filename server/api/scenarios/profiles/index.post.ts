/**
 * POST /api/scenarios/profiles
 * Создание нового профиля генерации сценариев.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canCreate'],
    moduleSlug: 'script-generator',
  })

  const body = await readBody<{
    name?: string
    description?: string
    appId?: number
    isDefault?: boolean
    settings?: Record<string, unknown>
  }>(event)

  // --- Валидация ---

  if (!body?.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'name' обязательно",
    })
  }

  if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
    throw createError({
      statusCode: 400,
      message: "Поле 'settings' обязательно и должно быть объектом",
    })
  }

  // Валидация appId — если передан, проверяем существование
  if (body.appId !== undefined && body.appId !== null) {
    if (typeof body.appId !== 'number' || body.appId <= 0) {
      throw createError({
        statusCode: 400,
        message: "Поле 'appId' должно быть числом > 0",
      })
    }

    const app = await prisma.app.findUnique({ where: { id: body.appId } })
    if (!app) {
      throw createError({
        statusCode: 404,
        message: 'Приложение не найдено',
      })
    }
  }

  // Если isDefault=true — сбросить isDefault у остальных профилей для того же appId
  if (body.isDefault) {
    await prisma.scenarioGenerationProfile.updateMany({
      where: {
        appId: body.appId ?? null,
        isDefault: true,
      },
      data: { isDefault: false },
    })
  }

  const profile = await prisma.scenarioGenerationProfile.create({
    data: {
      name: body.name.trim(),
      description: body.description?.trim() || null,
      appId: body.appId ?? null,
      isDefault: body.isDefault ?? false,
      settings: body.settings as any,
    },
    include: {
      app: { select: { id: true, name: true } },
    },
  })

  return { data: profile }
})
