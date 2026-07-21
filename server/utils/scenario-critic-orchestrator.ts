/**
 * Scenario Critic Orchestrator — координирует loop AI-критика и rework.
 *
 * Шаги:
 * 1. Гейт SCENARIO_CRITIC_ENABLED — при выключенном просто returns {skipped:true}.
 * 2. Rate-limit: не более 5 CriticReview за 24ч на один scenarioId → 429.
 * 3. Loop iter 1..max: загрузить variants → критик → CriticReview → обновить
 *    qualityScore полей у variants → если needsRework и есть итерации в запасе:
 *    rework через regenerateBlock('fullScript', ...).
 * 4. После loop: автоматически выставить scenario.selectedVariantId = bestVariantId
 *    ТОЛЬКО если оператор ещё не выбрал (selectedVariantId === null).
 *
 * Не блокирует основной flow: callers оборачивают вызов в try/catch и логгируют.
 */

import { runScenarioQualityCritic, type CriticInput, CRITIC_PROMPT_VERSION, CRITIC_DEFAULT_THRESHOLD } from './agents/scenario-quality-critic'
import { regenerateBlock, type ScenarioInput } from './agents/scenario-pipeline'
import type { CriticOutput, VariantQualityScore } from '~~/shared/types/scenario'

const MAX_REWORK_ITERATIONS_DEFAULT = 2
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000
const RATE_LIMIT_MAX = 5

export interface CriticOrchestratorOptions {
  threshold?: number
  /**
   * Сколько итераций (включая первый проход) делать. 1 = только оценить, без rework.
   * Default: MAX_REWORK_ITERATIONS_DEFAULT.
   */
  maxIterations?: number
}

export interface CriticOrchestratorResult {
  skipped?: boolean
  reason?: string
  finalVariantId: number | null
  iterationsCount: number
  reviewIds: number[]
  reachedThreshold: boolean
  averageScore: number
  needsRework: boolean
}

function isCriticEnabled(): boolean {
  // Читаем env напрямую (как и в других гейтах проекта, например requirePaidApisEnabled),
  // чтобы значение читалось из рантайм-окружения, а не запекалось в server-bundle.
  // По умолчанию critic включён; явное "false" выключает.
  return process.env.SCENARIO_CRITIC_ENABLED !== 'false'
}

/**
 * Восстанавливает минимальный ScenarioInput для regenerateBlock из БД.
 * Нужно для rework — без него regenerateBlock не примет сценарий.
 */
async function buildScenarioInputFromDb(scenarioId: number): Promise<ScenarioInput | null> {
  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    include: {
      trend: {
        include: { brief: true, insights: true, app: true },
      },
    },
  })
  if (!scenario || !scenario.trend) return null
  const trend = scenario.trend
  if (!trend.app) return null

  return {
    trendTitle: trend.title,
    trendDescription: trend.description,
    platform: trend.platform,
    hashtags: trend.hashtags,
    viewCount: trend.viewCount,
    brief: trend.brief
      ? {
          hookAnalysis: trend.brief.hookAnalysis as never,
          sceneStructure: trend.brief.sceneStructure as never,
          visualStyle: trend.brief.visualStyle as never,
          viralityReasons: trend.brief.viralityReasons as never,
          summary: trend.brief.summary,
        }
      : null,
    insights: trend.insights.map((i) => ({
      whyViral: i.whyViral,
      patterns: i.patterns,
      hooks: i.hooks,
      audience: i.audience,
    })),
    appName: trend.app.name,
    appDescription: trend.app.description,
    appKeywords: trend.app.keywords,
    appId: trend.app.id,
  }
}

/**
 * Применяет rework для variants со score ниже threshold. Использует
 * regenerateBlock('fullScript', ...) с reworkSuggestions как reason.
 * Возвращает количество успешно перегенерированных variants.
 */
async function reworkVariants(
  scenarioId: number,
  scores: VariantQualityScore[],
  threshold: number,
): Promise<number> {
  const scenarioInput = await buildScenarioInputFromDb(scenarioId)
  if (!scenarioInput) {
    console.warn('[scenario-critic] не удалось собрать ScenarioInput для rework, пропускаем', { scenarioId })
    return 0
  }

  let reworked = 0
  for (const score of scores) {
    if (score.totalScore >= threshold) continue
    if (score.reworkSuggestions.length === 0) continue

    const variant = await prisma.scenarioVariant.findUnique({
      where: { id: score.variantId },
    })
    if (!variant || variant.isDeleted) continue

    try {
      const reason = `Quality critic suggestions: ${score.reworkSuggestions.join('; ')}`
      const result = await regenerateBlock(
        'fullScript',
        {
          hook: variant.hook,
          body: variant.body,
          cta: variant.cta,
          fullScript: variant.fullScript,
          visualStyleText: variant.visualStyleText,
          storyPlan: variant.storyPlan,
        },
        scenarioInput,
        reason,
      )

      await prisma.$transaction(async (tx) => {
        await tx.scenarioBlockRevision.create({
          data: {
            variantId: variant.id,
            blockType: 'fullScript',
            oldValue: variant.fullScript,
            newValue: result.value,
            reason,
          },
        })
        await tx.scenarioVariant.update({
          where: { id: variant.id },
          data: { fullScript: result.value },
        })
      })
      reworked++
    } catch (err) {
      console.error('[scenario-critic] rework variant failed', {
        scenarioId,
        variantId: variant.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return reworked
}

/**
 * Запускает quality-critic loop для одного сценария. Идемпотентен (можно вызвать руками
 * с UI или планировщика). Не бросает на бизнес-ошибки кроме явных 429/инвариантов —
 * AI-фейл логгируется и orchestrator возвращает результат с пустым reviewIds.
 */
export async function runQualityCriticForScenario(
  scenarioId: number,
  options: CriticOrchestratorOptions = {},
): Promise<CriticOrchestratorResult> {
  if (!isCriticEnabled()) {
    return {
      skipped: true,
      reason: 'SCENARIO_CRITIC_ENABLED=false',
      finalVariantId: null,
      iterationsCount: 0,
      reviewIds: [],
      reachedThreshold: false,
      averageScore: 0,
      needsRework: false,
    }
  }

  const threshold = options.threshold ?? CRITIC_DEFAULT_THRESHOLD
  const maxIterations = Math.max(1, options.maxIterations ?? MAX_REWORK_ITERATIONS_DEFAULT)

  // Rate limit (5 reviews / 24h на scenarioId).
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS)
  const recentCount = await prisma.criticReview.count({
    where: { scenarioId, createdAt: { gte: since } },
  })
  if (recentCount >= RATE_LIMIT_MAX) {
    throw createError({
      statusCode: 429,
      message: `Превышен лимит критических ревью для сценария: ${RATE_LIMIT_MAX} за 24ч`,
    })
  }

  const reviewIds: number[] = []
  let lastOutput: CriticOutput | null = null
  let iterationsCount = 0

  for (let iter = 1; iter <= maxIterations; iter++) {
    iterationsCount = iter

    const variants = await prisma.scenarioVariant.findMany({
      where: { scenarioId, isDeleted: false },
      orderBy: { variantIndex: 'asc' },
    })
    if (variants.length === 0) {
      console.warn('[scenario-critic] нет вариантов для критика', { scenarioId })
      break
    }

    const criticInput: CriticInput = {
      scenarioId,
      variants: variants.map((v) => ({
        id: v.id,
        variantIndex: v.variantIndex,
        title: v.title,
        hook: v.hook,
        body: v.body,
        cta: v.cta,
        fullScript: v.fullScript,
        storyPlan: v.storyPlan ?? undefined,
      })),
      context: {
        qualityThreshold: threshold,
      },
    }

    // App name из БД для бренд-учёта в промпте.
    try {
      const scenarioRow = await prisma.scenario.findUnique({
        where: { id: scenarioId },
        include: { trend: { include: { app: { select: { name: true } } } } },
      })
      if (scenarioRow?.trend?.app?.name) {
        criticInput.context!.appName = scenarioRow.trend.app.name
      }
      if (scenarioRow?.trend?.platform) {
        criticInput.context!.targetPlatform = scenarioRow.trend.platform
      }
    } catch {
      // optional context, continue
    }

    const startedAt = Date.now()
    let output: CriticOutput
    try {
      output = await runScenarioQualityCritic(criticInput)
    } catch (err) {
      console.error('[scenario-critic] AI call failed', {
        scenarioId,
        iter,
        error: err instanceof Error ? err.message : String(err),
      })
      // Прерываем loop, не пишем CriticReview если AI ответ сломан.
      break
    }
    const durationMs = Date.now() - startedAt
    lastOutput = output

    // Persistence: CriticReview + qualityScore на variants.
    const reachedThreshold = !output.needsRework

    let review
    try {
      review = await prisma.criticReview.create({
        data: {
          scenarioId,
          iteration: iter,
          variantsReviewed: output.scores.length,
          bestVariantId: output.bestVariantId ?? null,
          averageScore: output.averageScore,
          needsRework: output.needsRework,
          reachedThreshold,
          fullReport: output as unknown as object,
          modelVersion: 'sonnet-4',
          promptVersion: CRITIC_PROMPT_VERSION,
          durationMs,
        },
      })
    } catch (err) {
      // P2002 unique violation на (scenarioId, iteration) — параллельный вызов уже записал
      // ревью с этой итерацией. Это race-condition guard; gracefully выходим из loop'а
      // вместо throw 500. Лог-предупреждение для observability.
      if ((err as { code?: string }).code === 'P2002') {
        console.warn('[scenario-critic] iteration race detected, breaking loop', {
          scenarioId,
          iteration: iter,
        })
        break
      }
      throw err
    }
    reviewIds.push(review.id)

    const checkedAt = new Date()
    await Promise.all(
      output.scores.map((s) =>
        prisma.scenarioVariant.update({
          where: { id: s.variantId },
          data: {
            qualityScore: s.totalScore,
            qualityScoreDetails: s as unknown as object,
            qualityCheckedAt: checkedAt,
          },
        }).catch((err) => {
          console.warn('[scenario-critic] не удалось обновить qualityScore варианта', {
            variantId: s.variantId,
            error: err instanceof Error ? err.message : String(err),
          })
        }),
      ),
    )

    // Записываем generationStatus как трассировку фазы.
    const phaseLabel = reachedThreshold ? 'critic_passed' : `critic_iter_${iter}`
    await prisma.scenario.update({
      where: { id: scenarioId },
      data: { generationStatus: phaseLabel },
    }).catch(() => {})

    if (!output.needsRework) {
      // Достигли порога — выходим
      break
    }

    // needsRework=true. Если итерации остались и rework разрешён (maxIterations>1) — переделываем.
    const hasIterationsLeft = iter < maxIterations
    if (!hasIterationsLeft) {
      // Last iteration — финальный статус critic_max_iter_reached
      await prisma.scenario.update({
        where: { id: scenarioId },
        data: { generationStatus: 'critic_max_iter_reached' },
      }).catch(() => {})
      break
    }

    await reworkVariants(scenarioId, output.scores, threshold)
    await prisma.scenario.update({
      where: { id: scenarioId },
      data: { generationStatus: `critic_rework_${iter}` },
    }).catch(() => {})
  }

  // Auto-select лучшего variant ТОЛЬКО если оператор ещё не выбрал.
  const reachedThreshold = lastOutput ? !lastOutput.needsRework : false
  let finalVariantId: number | null = null

  if (lastOutput && lastOutput.bestVariantId) {
    const scenarioRow = await prisma.scenario.findUnique({
      where: { id: scenarioId },
      select: { selectedVariantId: true },
    })
    if (scenarioRow && scenarioRow.selectedVariantId === null) {
      await prisma.scenario.update({
        where: { id: scenarioId },
        data: { selectedVariantId: lastOutput.bestVariantId },
      }).catch(() => {})
      finalVariantId = lastOutput.bestVariantId
    } else {
      finalVariantId = scenarioRow?.selectedVariantId ?? null
    }
  }

  return {
    finalVariantId,
    iterationsCount,
    reviewIds,
    reachedThreshold,
    averageScore: lastOutput?.averageScore ?? 0,
    needsRework: lastOutput?.needsRework ?? false,
  }
}
