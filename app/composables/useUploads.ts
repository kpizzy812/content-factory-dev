interface UploadFilters {
  status?: string
  videoId?: number
  page: number
  perPage: number
}

export function useUploads(filters: Ref<UploadFilters> | ComputedRef<UploadFilters>) {
  return useFetch('/api/uploads', {
    query: filters,
  })
}
