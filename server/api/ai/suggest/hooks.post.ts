/**
 * POST /api/ai/suggest/hooks
 * Генерация хуков для видео через HookAgent.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    scenario?: {
      title?: string
      hook?: string
      body?: string
      cta?: string
      visualStyle?: string
    }
    platform?: string
    count?: number
  }>(event)

  if (!body?.scenario?.title || !body.scenario.hook || !body.scenario.body || !body.scenario.cta) {
    throw createError({
      statusCode: 400,
      message: 'Поля scenario.title, scenario.hook, scenario.body, scenario.cta обязательны',
    })
  }

  const result = await runHookAgent({
    scenario: {
      title: body.scenario.title,
      hook: body.scenario.hook,
      body: body.scenario.body,
      cta: body.scenario.cta,
      visualStyle: body.scenario.visualStyle,
    },
    platform: body.platform,
    count: body.count,
  })

  return { data: result }
})
