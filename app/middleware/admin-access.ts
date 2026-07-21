/**
 * Named middleware для проверки доступа к админ-панели.
 * Редирект на главную при отсутствии canAdmin.
 * Fail-open: если данные ещё не загружены, пропускаем — серверный guard поймает.
 */
export default defineNuxtRouteMiddleware(() => {
  const { permissions, can } = usePermissions()

  // Если данные ещё не загружены — пропускаем (серверный RBAC защитит)
  if (!permissions.value?.data) return

  if (!can('canAdmin')) {
    return navigateTo('/')
  }
})
