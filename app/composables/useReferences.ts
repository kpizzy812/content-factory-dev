export function useReferences(query: MaybeRefOrGetter<Record<string, unknown>>) {
  return useFetch('/api/references', {
    query,
    watch: [query],
  })
}
