/**
 * POST /api/ai/suggest/keywords
 * Генерация хештегов и ключевых слов через KeywordAgent.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    appName?: string
    appDescription?: string
    niche?: string
    geo?: string
    language?: string
    platforms?: string[]
  }>(event)

  if (!body?.appName) {
    throw createError({
      statusCode: 400,
      message: 'Поле appName обязательно',
    })
  }

  const result = await runKeywordAgent({
    appName: body.appName,
    appDescription: body.appDescription,
    niche: body.niche,
    geo: body.geo,
    language: body.language,
    platforms: body.platforms,
  })

  return { data: result }
})
