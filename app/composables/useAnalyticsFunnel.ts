import type {
  AttributionModel,
  FunnelResult,
  PublicationChainResult,
  RankingsResult,
  TimeseriesMetric,
  TimeseriesResult,
} from '#shared/types/analytics-funnel'

/**
 * Сквозная аналитика: воронка, рейтинги, динамика и разбор публикации.
 *
 * Четыре отдельных запроса, а не один: каждый блок экрана грузится сам по
 * себе, и воронка не ждёт рейтингов.
 */

export function useAnalyticsFunnel(query: MaybeRefOrGetter<Record<string, unknown>>) {
  return useFetch<{ data: FunnelResult }>('/api/analytics/funnel', { query, watch: [query] })
}

export function useAnalyticsRankings(
  query: MaybeRefOrGetter<Record<string, unknown>>,
  model: Ref<AttributionModel>,
) {
  return useFetch<{ data: RankingsResult }>('/api/analytics/rankings', {
    query: computed(() => ({ ...toValue(query), model: model.value })),
    watch: [query, model],
  })
}

export function useAnalyticsTimeseries(
  query: MaybeRefOrGetter<Record<string, unknown>>,
  metric: Ref<TimeseriesMetric>,
) {
  return useFetch<{ data: TimeseriesResult }>('/api/analytics/timeseries', {
    query: computed(() => ({ ...toValue(query), metric: metric.value })),
    watch: [query, metric],
  })
}

export function useAnalyticsChain(uploadId: Ref<number | null>) {
  return useFetch<{ data: PublicationChainResult }>(
    () => `/api/analytics/chain/${uploadId.value ?? 0}`,
    {
      immediate: false,
      watch: [uploadId],
    },
  )
}
