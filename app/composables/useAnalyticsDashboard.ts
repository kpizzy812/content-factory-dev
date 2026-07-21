export function useAnalyticsDashboard(query: MaybeRefOrGetter<Record<string, unknown>>) {
  return useFetch('/api/analytics/dashboard', {
    query,
    watch: [query],
  })
}
