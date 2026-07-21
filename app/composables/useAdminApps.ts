/**
 * Загрузка списка приложений для админки.
 */
export function useAdminApps() {
  return useFetch('/api/admin/apps', {
    key: 'admin-apps',
  })
}
