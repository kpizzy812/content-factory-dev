/**
 * POST /api/ai/suggest/description
 * Генерация описаний для публикации через CopywritingAgent.
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
    }
    platforms?: string[]
    appName?: string
  }>(event)

  if (!body?.scenario?.title || !body.scenario.hook || !body.scenario.body || !body.scenario.cta) {
    throw createError({
      statusCode: 400,
      message: 'Поля scenario.title, scenario.hook, scenario.body, scenario.cta обязательны',
    })
  }

  if (!body.appName) {
    throw createError({
      statusCode: 400,
      message: 'Поле appName обязательно',
    })
  }

  const result = await runCopywritingAgent({
    scenario: {
      title: body.scenario.title,
      hook: body.scenario.hook,
      body: body.scenario.body,
      cta: body.scenario.cta,
    },
    platforms: body.platforms?.length ? body.platforms : ['tiktok', 'instagram', 'youtube'],
    appName: body.appName,
  })

  return { data: result }
})
