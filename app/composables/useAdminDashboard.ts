/**
 * Загрузка данных дашборда администратора.
 */
export function useAdminDashboard() {
  return useFetch('/api/admin/dashboard', {
    key: 'admin-dashboard',
  })
}
