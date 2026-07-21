interface VideoFilters {
  status?: string
  scenarioId?: number
  page?: number
  perPage?: number
}

export function useVideos(filters: Ref<VideoFilters> | ComputedRef<VideoFilters>) {
  return useFetch('/api/videos', {
    query: filters,
  })
}
