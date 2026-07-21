import type { DeviceSyncStatus } from "~~/shared/types/device-profile"

export const useDeviceFiltersStore = defineStore("deviceFilters", () => {
  const syncStatus = ref<DeviceSyncStatus | "">("")
  const search = ref<string>("")

  const query = computed(() => ({
    ...(syncStatus.value ? { syncStatus: syncStatus.value } : {}),
    ...(search.value.trim() ? { search: search.value.trim() } : {}),
  }))

  function reset() {
    syncStatus.value = ""
    search.value = ""
  }

  return { syncStatus, search, query, reset }
})
