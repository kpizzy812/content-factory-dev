/**
 * POST /api/ai/suggest/posting-time
 * Определение лучшего времени для публикации через PostingTimeAgent.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    platform?: string
    geo?: string
    niche?: string
  }>(event)

  if (!body?.platform || !body.geo) {
    throw createError({
      statusCode: 400,
      message: 'Поля platform и geo обязательны',
    })
  }

  const result = await runPostingTimeAgent({
    platform: body.platform,
    geo: body.geo,
    niche: body.niche,
  })

  return { data: result }
})
