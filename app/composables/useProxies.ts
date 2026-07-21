import type { ProxyDto } from "~~/shared/types/proxy"

/**
 * useProxies — реактивный fetch списка прокси с фильтрами из proxyFilters store.
 * Перефетчит автоматически при изменении query.
 */
export function useProxies() {
  const filters = useProxyFiltersStore()
  return useFetch<{ data: ProxyDto[] }>("/api/proxies", {
    query: computed(() => filters.query),
  })
}
