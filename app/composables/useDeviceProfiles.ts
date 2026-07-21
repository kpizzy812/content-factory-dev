import type { DeviceProfileDto } from "~~/shared/types/device-profile"

/**
 * Реактивный fetch списка device-профилей с фильтрами из deviceFilters store.
 */
export function useDeviceProfiles() {
  const filters = useDeviceFiltersStore()
  return useFetch<{ data: DeviceProfileDto[] }>("/api/device-profiles", {
    query: computed(() => filters.query),
  })
}
