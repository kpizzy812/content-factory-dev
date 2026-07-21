export function useUploadDetail(id: Ref<number | string> | ComputedRef<number | string>) {
  return useFetch(`/api/uploads/${unref(id)}` as '/api/uploads/:id', {
    watch: [id],
  })
}
