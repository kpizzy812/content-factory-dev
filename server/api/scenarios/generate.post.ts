/**
 * POST /api/scenarios/generate
 * Генерация сценария из тренда с использованием CreativeBrief как primary source.
 */
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

  try {
    const generated = await generateScenarios(
      {
        title: trend.title,
        description: trend.description,
        platform: trend.platform,
        hashtags: trend.hashtags,
        viewCount: trend.viewCount,
        insights: trend.insights.map(i => ({
          whyViral: i.whyViral,
          patterns: i.patterns,
          hooks: i.hooks,
          audience: i.audience,
        })),
        brief: trend.brief
          ? {
              hookAnalysis: trend.brief.hookAnalysis as any,
              sceneStructure: trend.brief.sceneStructure as any,
              visualStyle: trend.brief.visualStyle as any,
              viralityReasons: trend.brief.viralityReasons as any,
              summary: trend.brief.summary,
            }
          : null,
      },
      {
        name: trend.app.name,
        description: trend.app.description,
        keywords: trend.app.keywords,
        transformationPromise: trend.app.transformationPromise,
        corePain: trend.app.corePain,
        coreOutcome: trend.app.coreOutcome,
        creativeAngles: trend.app.creativeAngles,
        scenarioContext: trend.app.scenarioContext,
      },
      variantsCount,
      trend.appId,
      profileSettings,
    )

    // Сохраняем варианты (с storyPlan)
    const result = await prisma.$transaction(async (tx) => {
      const variants = await Promise.all(
        generated.map((v, index) =>
          tx.scenarioVariant.create({
            data: {
              scenarioId: scenario.id,
              variantIndex: index,
              title: v.title,
              hook: v.hook,
              body: v.body,
              cta: v.cta,
              fullScript: v.fullScript,
              visualStyleText: v.visualStyleText,
              visualStyleStructured: v.visualStyleStructured as any,
              storyPlan: v.storyPlan as any,
              toneProfile: v.toneProfile,
              rationale: v.rationale,
              promptVersion: '3.0.0',
            },
          }),
        ),
      )

      const updated = await tx.scenario.update({
        where: { id: scenario.id },
        data: {
          status: 'generated',
          generationStatus: 'completed',
        },
        include: {
          variants: { where: { isDeleted: false }, orderBy: { variantIndex: 'asc' } },
          trend: { select: { id: true, title: true, platform: true } },
        },
      })

      // Обновить статус тренда
      if (trend.status === 'reviewed') {
        await tx.trend.update({
          where: { id: trendId },
          data: { status: 'in_work' },
        })
      }

      return updated
    })

    // Quality Critic loop (gated by SCENARIO_CRITIC_ENABLED).
    // Не блокируем основной flow: сценарий уже сохранён, варианты есть,
    // даже если critic упадёт — UI отобразит «Не проверено».
    try {
      const { runQualityCriticForScenario } = await import('~~/server/utils/scenario-critic-orchestrator')
      await runQualityCriticForScenario(scenario.id)
    } catch (criticErr) {
      console.error('[scenario-critic] failed in generate.post:', criticErr)
    }

    return { data: result }
  } catch (err) {
    // Обновляем статус в случае ошибки
    await prisma.scenario.update({
      where: { id: scenario.id },
      data: {
        status: 'draft',
        generationStatus: `failed: ${err instanceof Error ? err.message : 'unknown'}`,
      },
    }).catch(() => {})

    throw err
  }
})
