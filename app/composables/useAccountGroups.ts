interface AccountGroupFilters {
  appId?: number
}

export function useAccountGroups(filters: Ref<AccountGroupFilters> | ComputedRef<AccountGroupFilters>) {
  return useFetch('/api/account-groups', {
    query: filters,
  })
}
