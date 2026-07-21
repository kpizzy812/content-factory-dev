interface ScenarioFilters {
  trendId?: number
  status?: string
  page?: number
  perPage?: number
}

export function useScenarios(filters: Ref<ScenarioFilters> | ComputedRef<ScenarioFilters>) {
  return useFetch('/api/scenarios', {
    query: filters,
  })
}
