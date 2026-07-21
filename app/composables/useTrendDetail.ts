export function useTrendDetail(id: Ref<number | string> | ComputedRef<number | string>) {
  return useFetch(`/api/trends/${unref(id)}` as '/api/trends/:id', {
    watch: [id],
  })
}
