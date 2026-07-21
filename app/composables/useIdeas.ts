interface IdeaFilters {
  status?: string
  source?: string
  appId?: number
  page?: number
  perPage?: number
}

export function useIdeas(filters: Ref<IdeaFilters> | ComputedRef<IdeaFilters>) {
  return useFetch('/api/ideas', {
    query: filters,
  })
}
