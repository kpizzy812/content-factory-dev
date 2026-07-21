/**
 * POST /api/scenarios/:id/regenerate-block
 * Перегенерация отдельного блока варианта.
 */
import { regenerateBlock } from '~~/server/utils/agents/scenario-pipeline'
import type { ScenarioInput } from '~~/server/utils/agents/scenario-pipeline'
import { regenerateSceneBlock } from '~~/server/utils/scene-driven-rework'

const VALID_BLOCKS = ['hook', 'body', 'cta', 'visualStyle', 'fullScript'] as const
type BlockType = typeof VALID_BLOCKS[number]

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const body = await readBody<{
    variantId?: number
    blockType?: string
    reason?: string
  }>(event)

  if (!body?.variantId || typeof body.variantId !== 'number') {
    throw createError({ statusCode: 400, message: "Поле 'variantId' обязательно" })
  }

  if (!body.blockType || !VALID_BLOCKS.includes(body.blockType as BlockType)) {
    throw createError({
      statusCode: 400,
      message: `Поле 'blockType' должно быть одним из: ${VALID_BLOCKS.join(', ')}`,
    })
  }

  const blockType = body.blockType as BlockType

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
    permissions: ['canWrite', 'canRunAgent'],
    moduleSlug: 'script-generator',
    appId: variant.scenario.appId ?? undefined,
  })

  if (variant.scenario.isDeleted) {
    throw createError({ statusCode: 400, message: 'Нельзя перегенерировать блок удалённого сценария' })
  }

  const trend = variant.scenario.trend

  // Scene-driven path: shadow Scenario без trend, но с sceneId.
  // regenerateSceneBlock внутри создаёт ревизию + ScenarioReviewAction.
  const isSceneDriven = !trend && variant.scenario.sceneId !== null
  if (isSceneDriven) {
    const result = await regenerateSceneBlock(body.variantId, blockType, body.reason)
    return { data: result.variant, regeneratedBlock: blockType }
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

  // Определяем старое значение для ревизии
  const oldValueMap: Record<BlockType, string> = {
    hook: variant.hook,
    body: variant.body,
    cta: variant.cta,
    fullScript: variant.fullScript,
    visualStyle: variant.visualStyleText,
  }

  const result = await regenerateBlock(
    blockType,
    {
      hook: variant.hook,
      body: variant.body,
      cta: variant.cta,
      fullScript: variant.fullScript,
      visualStyleText: variant.visualStyleText,
      storyPlan: variant.storyPlan,
    },
    scenarioInput,
    body.reason,
  )

  // Сохраняем ревизию и обновляем вариант
  await prisma.$transaction(async (tx) => {
    await tx.scenarioBlockRevision.create({
      data: {
        variantId: body.variantId!,
        blockType,
        oldValue: oldValueMap[blockType],
        newValue: result.value,
        reason: body.reason || null,
      },
    })

    const updateData: Record<string, unknown> = {}
    if (blockType === 'visualStyle') {
      updateData.visualStyleText = result.value
      if (result.structuredVisualStyle) {
        updateData.visualStyleStructured = result.structuredVisualStyle as any
      }
    } else {
      updateData[blockType] = result.value
    }

    await tx.scenarioVariant.update({
      where: { id: body.variantId! },
      data: updateData,
    })

    await tx.scenarioReviewAction.create({
      data: {
        scenarioId: id,
        variantId: body.variantId!,
        actionType: 'regenerate_block',
        reason: `${blockType}${body.reason ? `: ${body.reason}` : ''}`,
      },
    })
  })

  const updated = await prisma.scenarioVariant.findUnique({
    where: { id: body.variantId },
  })

  return { data: updated, regeneratedBlock: blockType }
})
