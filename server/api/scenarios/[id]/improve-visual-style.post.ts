/**
 * POST /api/scenarios/:id/improve-visual-style
 * Улучшение visual style prompt для варианта.
 */
import { improveVisualStylePrompt } from '~~/server/utils/agents/scenario-pipeline'
import { improveSceneVisualStyle } from '~~/server/utils/scene-driven-rework'
import type { VisualStyleStructured } from '~~/shared/types/scenario'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const body = await readBody<{ variantId?: number }>(event)
  if (!body?.variantId || typeof body.variantId !== 'number') {
    throw createError({ statusCode: 400, message: "Поле 'variantId' обязательно" })
  }

  const variant = await prisma.scenarioVariant.findUnique({
    where: { id: body.variantId },
    include: {
      scenario: {
        include: {
          trend: { select: { platform: true, app: { select: { name: true } } } },
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
    throw createError({ statusCode: 400, message: 'Нельзя улучшать стиль удалённого сценария' })
  }

  // Scene-driven path: shadow Scenario без trend, но с sceneId.
  // improveSceneVisualStyle переиспользует improveVisualStylePrompt с appName из
  // scenario.app (не trend.app, которого нет).
  const isSceneDriven = !variant.scenario.trend && variant.scenario.sceneId !== null
  if (isSceneDriven) {
    try {
      const result = await improveSceneVisualStyle(body.variantId)
      return { data: result.variant, improvedPrompt: result.improvedPrompt }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 'Visual style ещё не структурирован' — это пользовательская ошибка, 400.
      if (message.includes('Visual style ещё не структурирован')) {
        throw createError({ statusCode: 400, message })
      }
      throw err
    }
  }

  if (!variant.scenario.trend) {
    throw createError({
      statusCode: 400,
      message: 'Сценарий без тренда и без сцены — нечего улучшать',
    })
  }

  const currentStyle = variant.visualStyleStructured as VisualStyleStructured | null
  if (!currentStyle || !currentStyle.colors) {
    throw createError({
      statusCode: 400,
      message: 'Visual style ещё не структурирован. Сначала перегенерируйте visual style.',
    })
  }

  const result = await improveVisualStylePrompt(currentStyle, {
    hook: variant.hook,
    body: variant.body,
    platform: variant.scenario.trend.platform,
    appName: variant.scenario.trend.app?.name || '',
  })

  // Сохраняем ревизию и обновляем
  await prisma.$transaction(async (tx) => {
    await tx.visualStyleRevision.create({
      data: {
        variantId: body.variantId!,
        colors: result.improvedStyle.colors as any,
        atmosphere: result.improvedStyle.atmosphere,
        character: result.improvedStyle.character,
        stylePrompt: result.improvedStyle.stylePrompt,
        improvedPrompt: result.improvedPrompt,
        source: 'improve_agent',
      },
    })

    await tx.scenarioVariant.update({
      where: { id: body.variantId! },
      data: {
        visualStyleStructured: result.improvedStyle as any,
        visualStyleText: `${result.improvedStyle.atmosphere}. ${result.improvedStyle.character}`,
      },
    })
  })

  const updated = await prisma.scenarioVariant.findUnique({
    where: { id: body.variantId },
  })

  return { data: updated, improvedPrompt: result.improvedPrompt }
})
