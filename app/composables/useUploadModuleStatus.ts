import type { UploadModuleStatus } from '~~/shared/types/upload'

export function useUploadModuleStatus() {
  const { data, refresh, status: fetchStatus } = useFetch<{ data: UploadModuleStatus }>('/api/uploads/module-status')

  const moduleStatus = computed(() => data.value?.data ?? null)
  const isEnabled = computed(() => moduleStatus.value?.enabled ?? false)
  const platforms = computed(() => moduleStatus.value?.platforms ?? {})
  const statusCounts = computed(() => moduleStatus.value?.statusCounts ?? {})
  const isLoading = computed(() => fetchStatus.value === 'pending')

  return {
    moduleStatus,
    isEnabled,
    platforms,
    statusCounts,
    isLoading,
    refresh,
  }
}
