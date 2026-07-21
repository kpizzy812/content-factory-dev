/**
 * POST /api/scenarios/:id/rework-regenerate
 * Перегенерация варианта с учётом причины доработки.
 * Перерабатывает все блоки (hook, body, cta, visualStyle, fullScript) через AI
 * с контекстом reworkRequest.
 */
import { regenerateBlock } from '~~/server/utils/agents/scenario-pipeline'
import type { ScenarioInput } from '~~/server/utils/agents/scenario-pipeline'
import { reworkSceneVariant } from '~~/server/utils/scene-driven-rework'

const BLOCKS = ['hook', 'body', 'cta', 'visualStyle', 'fullScript'] as const

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const body = await readBody<{ variantId?: number }>(event)
  if (!body?.variantId || typeof body.variantId !== 'number') {
    throw createError({ statusCode: 400, message: "Поле 'variantId' обязательно" })
  }

  // Загружаем вариант со всем контекстом
  const variant = await prisma.scenarioVariant.findUnique({
    where: { id: body.variantId },
    include: {
      scenario: {
        include: {
          trend: {
            include: { brief: true, insights: true, app: true },
          },
        },
      },
    },
  })

  if (!variant || variant.scenarioId !== id) {
    throw createError({ statusCode: 404, message: 'Вариант не найден' })
  }

  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'script-generator',
    appId: variant.scenario.appId ?? undefined,
  })

  if (variant.scenario.isDeleted) {
    throw createError({ statusCode: 400, message: 'Нельзя работать с удалённым сценарием' })
  }

  if (variant.status !== 'needs_rework') {
    throw createError({
      statusCode: 400,
      message: `Вариант должен быть в статусе 'needs_rework', текущий: ${variant.status}`,
    })
  }

  const trend = variant.scenario.trend
  const reworkReason = variant.scenario.reworkRequest || 'Общая переработка'

  // Scene-driven path: shadow Scenario без trend, но с sceneId.
  // Делегируем в scene-driven-rework, который вызывает scene-scripter + перегенерирует
  // все 5 блоков + создаёт ScenarioBlockRevision + ScenarioReviewAction.
  const isSceneDriven = !trend && variant.scenario.sceneId !== null
  if (isSceneDriven) {
    await prisma.scenario.update({
      where: { id },
      data: { status: 'generating', generationStatus: `rework (scene-driven): ${reworkReason}` },
    })
    try {
      const result = await reworkSceneVariant(body.variantId, reworkReason)
      return { data: result.variant, reworkCompleted: true }
    } catch (err) {
      await prisma.scenario.update({
        where: { id },
        data: {
          status: 'needs_rework',
          generationStatus: `rework failed: ${err instanceof Error ? err.message : 'unknown'}`,
        },
      }).catch(() => {})
      throw err
    }
  }

  if (!trend) {
    throw createError({
      statusCode: 400,
      message: 'Сценарий без тренда и без сцены — нечего перегенерировать',
    })
  }
  if (!trend.app) {
    throw createError({ statusCode: 400, message: 'У тренда не привязано приложение' })
  }

  const scenarioInput: ScenarioInput = {
    trendTitle: trend.title,
    trendDescription: trend.description,
    platform: trend.platform,
    hashtags: trend.hashtags,
    viewCount: trend.viewCount,
    brief: trend.brief
      ? {
          hookAnalysis: trend.brief.hookAnalysis as any,
          sceneStructure: trend.brief.sceneStructure as any,
          visualStyle: trend.brief.visualStyle as any,
          viralityReasons: trend.brief.viralityReasons as any,
          summary: trend.brief.summary,
        }
      : null,
    insights: trend.insights.map(i => ({
      whyViral: i.whyViral,
      patterns: i.patterns,
      hooks: i.hooks,
      audience: i.audience,
    })),
    appName: trend.app.name,
    appDescription: trend.app.description,
    appKeywords: trend.app.keywords,
  }

  // Обновляем статус: сценарий в процессе переработки
  await prisma.scenario.update({
    where: { id },
    data: { status: 'generating', generationStatus: `rework: ${reworkReason}` },
  })

  try {
    const currentVariant = {
      hook: variant.hook,
      body: variant.body,
      cta: variant.cta,
      fullScript: variant.fullScript,
      visualStyleText: variant.visualStyleText,
      storyPlan: variant.storyPlan,
    }

    // Перегенерируем все блоки последовательно с причиной доработки
    const results: Record<string, { value: string; structuredVisualStyle?: unknown }> = {}

    for (const blockType of BLOCKS) {
      results[blockType] = await regenerateBlock(
        blockType,
        currentVariant,
        scenarioInput,
        reworkReason,
      )

      // Обновляем currentVariant по мере получения новых блоков,
      // чтобы следующие блоки учитывали уже перегенерированные
      if (blockType === 'hook') currentVariant.hook = results[blockType]!.value
      else if (blockType === 'body') currentVariant.body = results[blockType]!.value
      else if (blockType === 'cta') currentVariant.cta = results[blockType]!.value
      else if (blockType === 'fullScript') currentVariant.fullScript = results[blockType]!.value
      else if (blockType === 'visualStyle') currentVariant.visualStyleText = results[blockType]!.value
    }

    // Сохраняем ревизии и обновляем вариант атомарно
    await prisma.$transaction(async (tx) => {
      const oldValues: Record<string, string> = {
        hook: variant.hook,
        body: variant.body,
        cta: variant.cta,
        fullScript: variant.fullScript,
        visualStyle: variant.visualStyleText,
      }

      for (const blockType of BLOCKS) {
        const result = results[blockType]!
        await tx.scenarioBlockRevision.create({
          data: {
            variantId: body.variantId!,
            blockType,
            oldValue: oldValues[blockType]!,
            newValue: result.value,
            reason: `Доработка: ${reworkReason}`,
          },
        })
      }

      const updateData: Record<string, unknown> = {
        hook: results.hook!.value,
        body: results.body!.value,
        cta: results.cta!.value,
        fullScript: results.fullScript!.value,
        visualStyleText: results.visualStyle!.value,
        status: 'draft',
      }

      if (results.visualStyle!.structuredVisualStyle) {
        updateData.visualStyleStructured = results.visualStyle!.structuredVisualStyle as any
      }

      await tx.scenarioVariant.update({
        where: { id: body.variantId! },
        data: updateData,
      })

      await tx.scenario.update({
        where: { id },
        data: {
          status: 'generated',
          generationStatus: 'rework completed',
          reworkRequest: null,
        },
      })

      await tx.scenarioReviewAction.create({
        data: {
          scenarioId: id,
          variantId: body.variantId!,
          actionType: 'regenerate',
          reason: `Полная переработка: ${reworkReason}`,
        },
      })
    })

    const updated = await prisma.scenarioVariant.findUnique({
      where: { id: body.variantId },
    })

    return { data: updated, reworkCompleted: true }
  } catch (err) {
    // Откатываем статус при ошибке
    await prisma.scenario.update({
      where: { id },
      data: {
        status: 'needs_rework',
        generationStatus: `rework failed: ${err instanceof Error ? err.message : 'unknown'}`,
      },
    }).catch(() => {})

    throw err
  }
})
