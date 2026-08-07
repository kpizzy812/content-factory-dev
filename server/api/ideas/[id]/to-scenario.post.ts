/**
 * Генерация сценариев из идеи через полноценный scenario pipeline.
 * Использует IdeaAnalysis (структурированный анализ) как primary source для CreativeBrief-совместимого ввода.
 * Если IdeaAnalysis нет — fallback на плоские поля идеи.
 */

import { generateScenarios } from '~~/server/utils/anthropic'
import { resolveScenarioFunnel } from '~~/server/utils/scenario-funnel'

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canCreate', 'canRunAgent'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID идеи' })
  }

  const body = await readBody<{ variantsCount?: number; useReference?: boolean }>(event).catch(() => null)
  const variantsCount = Math.min(5, Math.max(1, body?.variantsCount || 3))
  const useReference = body?.useReference ?? true // По умолчанию используем reference если есть

  const idea = await prisma.idea.findUnique({
    where: { id },
    include: {
      app: true,
      analysis: true,
    },
  })

  if (!idea || idea.isDeleted) {
    throw createError({ statusCode: 404, message: 'Идея не найдена' })
  }

  if (idea.status !== 'ready') {
    throw createError({
      statusCode: 400,
      message: `Идея должна быть в статусе ready, текущий: ${idea.status}`,
    })
  }

  requirePaidApisEnabled('Anthropic Claude API')

  if (!process.env.ANTHROPIC_API_KEY) {
    throw createError({
      statusCode: 500,
      message: 'ANTHROPIC_API_KEY не настроен',
    })
  }

  // Создаём тренд-запись как контейнер для сценария (архитектура Scenario требует trendId)
  const trend = await prisma.trend.create({
    data: {
      appId: idea.appId,
      platform: idea.platform ?? 'youtube',
      sourceUrl: idea.sourceUrl ?? '',
      title: idea.title ?? 'Из идеи',
      description: idea.body,
      status: 'in_work',
      analysisStatus: idea.analysis ? 'completed' : 'none',
    },
  })

  // Если есть структурированный анализ — сохраняем как CreativeBrief для тренда
  if (idea.analysis) {
    await prisma.creativeBrief.create({
      data: {
        trendId: trend.id,
        hookAnalysis: idea.analysis.hookAnalysis as any,
        sceneStructure: idea.analysis.sceneStructure as any,
        visualStyle: idea.analysis.visualStyle as any,
        viralityReasons: idea.analysis.viralityReasons as any,
        summary: idea.analysis.summary,
        modelVersion: idea.analysis.modelVersion,
        promptVersion: idea.analysis.promptVersion,
        confidence: idea.analysis.confidence,
      },
    })
  }

  // Собираем insights из плоских полей (fallback)
  const insights = idea.whyViral
    ? [{
        whyViral: idea.whyViral,
        patterns: [idea.hook, idea.body, idea.cta].filter(Boolean) as string[],
        hooks: idea.hook ? [idea.hook] : [],
        audience: null,
      }]
    : []

  // Собираем brief из IdeaAnalysis если есть
  const brief = idea.analysis
    ? {
        hookAnalysis: idea.analysis.hookAnalysis as any,
        sceneStructure: idea.analysis.sceneStructure as any,
        visualStyle: idea.analysis.visualStyle as any,
        viralityReasons: idea.analysis.viralityReasons as any,
        summary: idea.analysis.summary,
      }
    : null

  // Извлекаем reference breakdown если доступен и useReference=true
  const referenceBreakdown = (useReference && idea.analysis?.referenceBreakdown)
    ? idea.analysis.referenceBreakdown as Record<string, unknown>
    : null

  // Активная воронка юнита. Без неё генератор уходит в ветку «назови приложение
  // и скачай», хотя по ТЗ конверсия идёт через кодовое слово в директ
  // (docs/PROJECT_CONTEXT.md §9). Резолвер и формат те же, что у ручного
  // /api/scenarios/generate и сценарной ноды конвейера — иначе сценарий,
  // рождённый из идеи, расходится с остальными путями.
  // Idea.appId необязателен: у идеи без юнита воронки быть не может.
  const funnelResolution = idea.appId === null ? null : await resolveScenarioFunnel(idea.appId)
  const funnel = funnelResolution?.funnel ?? null
  if (funnelResolution?.warning) {
    await logAgent('ideas-to-scenario', 'warn', funnelResolution.warning).catch(() => {})
  }
  if (funnelResolution && !funnelResolution.funnel) {
    await logAgent('ideas-to-scenario', 'warn',
      `У юнита ${idea.appId} нет активной воронки — CTA будет про приложение, а не про кодовое слово в директ.`,
    ).catch(() => {})
  }

  // language обязателен: без него агенты получают undefined и пишут сценарий
  // по-английски, даже когда у юнита указан русский.
  const appData = idea.app
    ? {
        name: idea.app.name,
        description: idea.app.description,
        keywords: idea.app.keywords,
        language: idea.app.language,
        funnel,
      }
    : {
        name: 'Приложение',
        description: null,
        keywords: [],
        language: null,
        funnel,
      }

  const scenario = await prisma.scenario.create({
    data: {
      trendId: trend.id,
      briefId: null,
      appId: idea.appId,
      status: 'generating',
      generationStatus: 'started',
    },
  })

  try {
    const generated = await generateScenarios(
      {
        title: idea.title ?? 'Из идеи',
        description: idea.body,
        platform: idea.platform ?? 'youtube',
        hashtags: [],
        viewCount: 0,
        insights,
        brief,
        referenceBreakdown: referenceBreakdown ?? undefined,
      },
      appData,
      variantsCount,
    )

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
              promptVersion: '2.0.0',
            },
          }),
        ),
      )

      // Обновляем CreativeBrief привязку если был создан
      const createdBrief = await tx.creativeBrief.findUnique({ where: { trendId: trend.id } })
      const updated = await tx.scenario.update({
        where: { id: scenario.id },
        data: {
          status: 'generated',
          generationStatus: 'completed',
          briefId: createdBrief?.id ?? null,
        },
        include: {
          variants: { where: { isDeleted: false }, orderBy: { variantIndex: 'asc' } },
        },
      })

      return updated
    })

    // Quality Critic loop (gated by SCENARIO_CRITIC_ENABLED).
    try {
      const { runQualityCriticForScenario } = await import('~~/server/utils/scenario-critic-orchestrator')
      await runQualityCriticForScenario(scenario.id)
    } catch (criticErr) {
      console.error('[scenario-critic] failed in ideas/to-scenario:', criticErr)
    }

    // Обновить статус идеи
    await prisma.$transaction([
      prisma.idea.update({
        where: { id },
        data: { status: 'in_work', sentToScenarioAt: new Date() },
      }),
      prisma.ideaOperatorAction.create({
        data: {
          ideaId: id,
          actionType: 'send_to_scenario',
          actorId: user.id,
          reason: `Создан сценарий #${scenario.id} с ${variantsCount} вариантами`,
        },
      }),
    ])

    return { data: result }
  } catch (err) {
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
