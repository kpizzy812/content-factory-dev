/**
 * GET /api/analytics/timeseries
 * Один показатель по дням: просмотры, переходы, заявки или стоимость заявки.
 */
import type { TimeseriesMetric } from '~~/shared/types/analytics-funnel'
import { parseAnalyticsScope } from '../../utils/analytics/period'
import { computeTimeseries } from '../../utils/analytics/timeseries'

const METRICS: TimeseriesMetric[] = ['views', 'clicks', 'leads', 'costPerLead']

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'analytics' })

  const query = getQuery(event) as Record<string, unknown>
  const scope = parseAnalyticsScope(query)
  const requested = String(query.metric ?? '').trim() as TimeseriesMetric
  const metric = METRICS.includes(requested) ? requested : 'views'

  return { data: await computeTimeseries(scope, metric) }
})
