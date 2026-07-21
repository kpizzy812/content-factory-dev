/**
 * Named middleware для проверки доступа к модулю.
 * Страницы указывают moduleSlug в definePageMeta.
 * Fail-open: если данные ещё не загружены, пропускаем — серверный guard поймает.
 */
export default defineNuxtRouteMiddleware((to) => {
  const moduleSlug = to.meta.moduleSlug as string | undefined
  if (!moduleSlug) return

  const { permissions, canAccessModule } = usePermissions()

  // Если данные ещё не загружены — пропускаем (серверный RBAC защитит)
  if (!permissions.value?.data) return

  if (!canAccessModule(moduleSlug)) {
    return navigateTo('/')
  }
})
