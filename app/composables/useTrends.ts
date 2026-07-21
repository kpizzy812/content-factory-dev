import type { TrendListMeta } from '../../shared/types/trend'

interface TrendFilters {
  status?: string
  platform?: string
  appId?: number
  search?: string
  page?: number
  perPage?: number
  sort?: string
}

export function useTrends(filters: Ref<TrendFilters> | ComputedRef<TrendFilters>) {
  return useFetch('/api/trends', {
    query: filters,
  })
}
