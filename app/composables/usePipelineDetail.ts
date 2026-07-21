export function usePipelineDetail(id: Ref<number | string> | ComputedRef<number | string>) {
  return useFetch(() => `/api/pipelines/${unref(id)}`, {
    watch: [id],
  })
}
