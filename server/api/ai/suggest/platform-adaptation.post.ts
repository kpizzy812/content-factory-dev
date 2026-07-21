/**
 * POST /api/ai/suggest/platform-adaptation
 * Адаптация сценария под разные платформы через PlatformAdaptationAgent.
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
    platforms?: string[]
  }>(event)

  if (
    !body?.scenario?.title
    || !body.scenario.hook
    || !body.scenario.body
    || !body.scenario.cta
  ) {
    throw createError({
      statusCode: 400,
      message: 'Поля scenario.title, scenario.hook, scenario.body, scenario.cta обязательны',
    })
  }

  if (!body.platforms?.length) {
    throw createError({
      statusCode: 400,
      message: 'Массив platforms обязателен и не может быть пустым',
    })
  }

  const result = await runPlatformAdaptationAgent({
    scenario: {
      title: body.scenario.title,
      hook: body.scenario.hook,
      body: body.scenario.body,
      cta: body.scenario.cta,
      visualStyle: body.scenario.visualStyle,
    },
    platforms: body.platforms,
  })

  return { data: result }
})
