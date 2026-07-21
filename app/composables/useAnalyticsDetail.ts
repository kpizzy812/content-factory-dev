export function useAnalyticsDetail(uploadId: Ref<number | string> | ComputedRef<number | string>) {
  return useFetch(() => `/api/analytics/posts/${unref(uploadId)}`, {
    watch: [uploadId],
  })
}
