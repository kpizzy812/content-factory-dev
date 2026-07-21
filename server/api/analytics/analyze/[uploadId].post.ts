/**
 * POST /api/analytics/analyze/:uploadId
 * AI-анализ поста. С paid guard — использует Anthropic API.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'analytics' })

  const uploadId = Number(getRouterParam(event, "uploadId"))
  if (!uploadId || Number.isNaN(uploadId) || uploadId <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID загрузки" })
  }

  const result = await analyzePost(uploadId)

  return {
    data: {
      analysis: result.analysis,
      referenceCreated: result.referenceCreated,
    },
  }
})
