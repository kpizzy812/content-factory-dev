/**
 * POST /api/ai/suggest/visual-style
 * Генерация визуального стиля через VisualStyleAgent.
 */
import type { VisualStyleInput } from '~~/shared/types/agents'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    scenarioHook?: string
    scenarioBody?: string
    scenarioTitle?: string
    scenarioCta?: string
    appName?: string
  }>(event)

  if (!body?.scenarioHook || !body.scenarioBody || !body.appName) {
    throw createError({
      statusCode: 400,
      message: 'Поля scenarioHook, scenarioBody и appName обязательны',
    })
  }

  const input: VisualStyleInput = {
    scenario: {
      title: body.scenarioTitle ?? body.scenarioHook.slice(0, 60),
      hook: body.scenarioHook,
      body: body.scenarioBody,
      cta: body.scenarioCta ?? '',
    },
    appName: body.appName,
  }

  const result = await runVisualStyleAgent(input)
  return { data: result }
})
