export function useVideoDetail(id: Ref<number | string> | ComputedRef<number | string>) {
  return useFetch(`/api/videos/${unref(id)}` as '/api/videos/:id', {
    watch: [id],
  })
}
