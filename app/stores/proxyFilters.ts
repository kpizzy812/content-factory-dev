import type { ProxyStatus, ProxyType } from "~~/shared/types/proxy"

export const useProxyFiltersStore = defineStore("proxyFilters", () => {
  const status = ref<ProxyStatus | "">("")
  const type = ref<ProxyType | "">("")
  const search = ref<string>("")

  const query = computed(() => ({
    ...(status.value ? { status: status.value } : {}),
    ...(type.value ? { type: type.value } : {}),
    ...(search.value.trim() ? { search: search.value.trim() } : {}),
  }))

  function reset() {
    status.value = ""
    type.value = ""
    search.value = ""
  }

  return { status, type, search, query, reset }
})
