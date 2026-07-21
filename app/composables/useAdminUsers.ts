/**
 * Загрузка списка пользователей для админки.
 */
export function useAdminUsers(query?: Ref<Record<string, unknown>> | ComputedRef<Record<string, unknown>>) {
  return useFetch('/api/admin/users', {
    key: 'admin-users',
    query: query ?? {},
    watch: query ? [query] : undefined,
  })
}
