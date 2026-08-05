/**
 * Фоновая генерация сценария.
 *
 * Полный проход агентов занимает пять и больше минут, а прокси перед приложением
 * рвёт HTTP-запрос на сотой секунде. Раньше это оставляло сценарий навсегда в
 * статусе `generating`: тренд блокировался, повторный запуск отвечал 409, и
 * лечилось только удалением записи руками.
 *
 * Теперь endpoint создаёт запись и сразу отвечает, а работа идёт здесь.
 * Клиент опрашивает GET /api/scenarios/:id и видит статус.
 */

import { prisma } from './prisma'
import { generateScenarios } from './anthropic'

export interface ScenarioGenerationRequest {
  scenarioId: number
  trendId: number
  variantsCount: number
  profileSettings: Record<string, unknown> | null
}

/**
 * Считает сценарий брошенным, если запись висит в `generating` дольше этого срока.
 * Больше самого долгого прохода агентов с запасом на ретраи внешних вызовов.
 */
export const SCENARIO_GENERATION_STALE_MS = 30 * 60 * 1000

export async function runScenarioGeneration(request: ScenarioGenerationRequest): Promise<void> {
  const { scenarioId, trendId, variantsCount, profileSettings } = request

  try {
    const trend = await prisma.trend.findUnique({
      where: { id: trendId },
      include: {
        insights: true,
        brief: true,
        app: {
          select: {
            id: true, name: true, description: true, keywords: true,
            language: true,
            transformationPromise: true, corePain: true, coreOutcome: true,
            creativeAngles: true, scenarioContext: true,
          },
        },
      },
    })
    if (!trend?.app || !trend.appId) {
      throw new Error('Тренд или его приложение исчезли между постановкой задачи и запуском')
    }

    // Активная воронка юнита. Её кодовое слово становится целью CTA: зритель
    // пишет слово в директ и получает лид-магнит, а не устанавливает приложение.
    const funnelRecord = await prisma.contentFunnel.findFirst({
      where: { appId: trend.appId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
      select: { keyword: true, leadMagnet: { select: { title: true } } },
    })
    const funnel = funnelRecord
      ? { keyword: funnelRecord.keyword, leadMagnetTitle: funnelRecord.leadMagnet?.title ?? null }
      : null

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
              hookAnalysis: trend.brief.hookAnalysis as never,
              sceneStructure: trend.brief.sceneStructure as never,
              visualStyle: trend.brief.visualStyle as never,
              viralityReasons: trend.brief.viralityReasons as never,
              summary: trend.brief.summary,
            }
          : null,
      },
      {
        name: trend.app.name,
        description: trend.app.description,
        keywords: trend.app.keywords,
        language: trend.app.language,
        transformationPromise: trend.app.transformationPromise,
        corePain: trend.app.corePain,
        coreOutcome: trend.app.coreOutcome,
        creativeAngles: trend.app.creativeAngles,
        scenarioContext: trend.app.scenarioContext,
        funnel,
      },
      variantsCount,
      trend.appId,
      profileSettings,
    )

    await prisma.$transaction(async (tx) => {
      await Promise.all(
        generated.map((v, index) =>
          tx.scenarioVariant.create({
            data: {
              scenarioId,
              variantIndex: index,
              title: v.title,
              hook: v.hook,
              body: v.body,
              cta: v.cta,
              fullScript: v.fullScript,
              visualStyleText: v.visualStyleText,
              visualStyleStructured: v.visualStyleStructured as never,
              storyPlan: v.storyPlan as never,
              toneProfile: v.toneProfile,
              rationale: v.rationale,
              promptVersion: '3.0.0',
            },
          }),
        ),
      )

      await tx.scenario.update({
        where: { id: scenarioId },
        data: { status: 'generated', generationStatus: 'completed' },
      })

      if (trend.status === 'reviewed') {
        await tx.trend.update({ where: { id: trendId }, data: { status: 'in_work' } })
      }
    })

    // Quality Critic loop (gated by SCENARIO_CRITIC_ENABLED).
    // Не блокируем основной flow: сценарий уже сохранён, варианты есть,
    // даже если critic упадёт — UI отобразит «Не проверено».
    try {
      const { runQualityCriticForScenario } = await import('./scenario-critic-orchestrator')
      await runQualityCriticForScenario(scenarioId)
    } catch (criticErr) {
      console.error('[scenario-critic] failed in background generation:', criticErr)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error(`[scenario-generation] scenario ${scenarioId} failed:`, err)
    await prisma.scenario.update({
      where: { id: scenarioId },
      data: {
        status: 'draft',
        generationStatus: `failed: ${message}`.slice(0, 500),
      },
    }).catch(() => {})
  }
}

/**
 * Сценарии, брошенные рестартом процесса. Фоновая задача живёт в памяти, поэтому
 * после перезапуска её никто не подхватит — запись надо освободить, иначе тренд
 * остаётся заблокированным навсегда.
 */
export async function releaseInterruptedScenarioGenerations(
  staleMs: number = SCENARIO_GENERATION_STALE_MS,
): Promise<number> {
  const result = await prisma.scenario.updateMany({
    where: {
      status: 'generating',
      updatedAt: { lt: new Date(Date.now() - staleMs) },
    },
    data: {
      status: 'draft',
      generationStatus: 'failed: генерация прервана рестартом процесса',
    },
  })
  return result.count
}
