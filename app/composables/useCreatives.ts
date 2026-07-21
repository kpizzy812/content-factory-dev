export function useCreatives(query: MaybeRefOrGetter<Record<string, unknown>>) {
  return useFetch('/api/creatives', {
    query,
    watch: [query],
  })
}
