/**
 * GET /api/analytics/rankings
 * Рейтинги ролика, аккаунта, хука и источника тренда плюс A/B по вариантам.
 *
 * `model=first|last` — кому достаётся заслуга за заявку. По умолчанию первое
 * касание: рейтинги отвечают на вопрос «что привело человека», а не «где он
 * оставил телефон».
 */
import type { AttributionModel } from '~~/shared/types/analytics-funnel'
import { parseAnalyticsScope } from '../../utils/analytics/period'
import { computeRankings } from '../../utils/analytics/rankings'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'analytics' })

  const query = getQuery(event) as Record<string, unknown>
  const scope = parseAnalyticsScope(query)
  const model: AttributionModel = String(query.model ?? '').trim() === 'last' ? 'last' : 'first'

  return { data: await computeRankings(scope, model) }
})
