/**
 * POST /api/scenarios/generate
 * Генерация сценария из тренда с использованием CreativeBrief как primary source.
 *
 * Отвечает сразу: проход агентов идёт пять и больше минут, а прокси рвёт запрос
 * на сотой секунде. Клиент получает id и опрашивает GET /api/scenarios/:id.
 */
import { runScenarioGeneration } from '~~/server/utils/scenario-generation-runner'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canCreate', 'canRunAgent'], moduleSlug: 'script-generator' })

  const body = await readBody<{ trendId?: number; variantsCount?: number; profileId?: number }>(event)

  if (!body?.trendId || typeof body.trendId !== 'number' || body.trendId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'trendId' обязательно и должно быть числом > 0",
    })
  }

  const trendId = body.trendId
  const variantsCount = Math.min(5, Math.max(1, body.variantsCount || 3))

  const trend = await prisma.trend.findUnique({
    where: { id: trendId },
    include: {
      insights: true,
      brief: true,
      app: {
        select: {
          id: true, name: true, description: true, keywords: true,
          // language обязателен: без него агенты получают undefined и пишут
          // сценарий по-английски, даже когда у юнита и тренда указан русский.
          language: true,
          transformationPromise: true, corePain: true, coreOutcome: true,
          creativeAngles: true, scenarioContext: true,
        },
      },
    },
  })

  if (!trend) {
    throw createError({ statusCode: 404, message: 'Тренд не найден' })
  }

  if (trend.isDeleted) {
    throw createError({
      statusCode: 400,
      message: 'Невозможно генерировать сценарии для удалённого тренда',
    })
  }

  if (trend.status !== 'reviewed' && trend.status !== 'in_work') {
    throw createError({
      statusCode: 400,
      message: `Тренд должен быть в статусе reviewed или in_work, текущий: ${trend.status}`,
    })
  }

  if (!trend.app || !trend.appId) {
    throw createError({
      statusCode: 400,
      message: 'У тренда не привязано приложение (appId)',
    })
  }

  // CreativeBrief — основной источник, TrendInsight — fallback
  if (!trend.brief && (!trend.insights || trend.insights.length === 0)) {
    throw createError({
      statusCode: 400,
      message: 'У тренда отсутствует CreativeBrief и инсайты для генерации сценариев',
    })
  }

  // Проверяем analysisStatus если есть brief
  if (trend.brief && trend.analysisStatus !== 'completed') {
    throw createError({
      statusCode: 400,
      message: `Анализ тренда не завершён (статус: ${trend.analysisStatus})`,
    })
  }

  // Проверка: активные не-удалённые сценарии уже существуют?
  const existingActive = await prisma.scenario.count({
    where: { trendId, isDeleted: false, status: { notIn: ['archived'] } },
  })

  if (existingActive > 0) {
    throw createError({
      statusCode: 409,
      message: 'Для этого тренда уже есть активные сценарии. Удалите или архивируйте их для перегенерации.',
    })
  }

  // Load profile settings if profileId specified
  let profileSettings = null as Record<string, unknown> | null
  if (body.profileId) {
    const profile = await prisma.scenarioGenerationProfile.findUnique({
      where: { id: body.profileId },
    })
    if (profile) {
      profileSettings = profile.settings as Record<string, unknown>
    }
  }

  // Создаём Scenario-запись со статусом generating
  const scenario = await prisma.scenario.create({
    data: {
      trendId,
      briefId: trend.brief?.id ?? null,
      appId: trend.appId,
      profileId: body.profileId ?? null,
      status: 'generating',
      generationStatus: 'started',
      sourceBriefVersion: trend.brief?.promptVersion ?? null,
    },
  })

  // Fire-and-forget: работа идёт в фоне, статус видно через GET /api/scenarios/:id.
  runScenarioGeneration({
    scenarioId: scenario.id,
    trendId,
    variantsCount,
    profileSettings,
  }).catch(() => { /* раннер сам пишет ошибку в generationStatus */ })

  setResponseStatus(event, 202)
  return {
    data: {
      id: scenario.id,
      trendId,
      status: scenario.status,
      generationStatus: scenario.generationStatus,
      variantsCount,
    },
  }
})
