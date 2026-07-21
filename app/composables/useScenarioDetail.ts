export function useScenarioDetail(id: Ref<number | string> | ComputedRef<number | string>) {
  return useFetch(`/api/scenarios/${unref(id)}` as '/api/scenarios/:id', {
    watch: [id],
  })
}
