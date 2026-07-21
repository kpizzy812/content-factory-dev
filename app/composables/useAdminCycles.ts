/**
 * Загрузка списка циклов для админки с фильтрами.
 */
export function useAdminCycles(query: MaybeRefOrGetter<Record<string, unknown>>) {
  return useFetch('/api/admin/cycles', {
    key: 'admin-cycles',
    query,
    watch: [query],
  })
}
