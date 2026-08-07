/**
 * GET /api/analytics/funnel
 * Воронка производства и продаж плюс KPI периода с дельтой к прошлому окну.
 */
import { computeFunnel } from '../../utils/analytics/funnel'
import { parseAnalyticsScope } from '../../utils/analytics/period'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'analytics' })

  const scope = parseAnalyticsScope(getQuery(event) as Record<string, unknown>)
  return { data: await computeFunnel(scope) }
})
