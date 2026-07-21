interface AccountFilters {
  appId?: number
  platform?: string
  status?: string
}

export function useAccounts(filters: Ref<AccountFilters> | ComputedRef<AccountFilters>) {
  return useFetch('/api/accounts', {
    query: filters,
  })
}
