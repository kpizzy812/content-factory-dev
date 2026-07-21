export function useAnalyticsPosts(query: MaybeRefOrGetter<Record<string, unknown>>) {
  return useFetch('/api/analytics/posts', {
    query,
    watch: [query],
  })
}
