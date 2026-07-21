interface PipelineFilters {
  page?: number
  perPage?: number
}

export function usePipelines(filters: Ref<PipelineFilters> | ComputedRef<PipelineFilters>) {
  return useFetch('/api/pipelines', {
    query: filters,
  })
}
