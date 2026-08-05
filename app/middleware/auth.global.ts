export default defineNuxtRouteMiddleware((to) => {
  // Явный whitelist публичных маршрутов для предотвращения бесконечного редиректа
  const publicPaths = ["/auth/login", "/auth"]

  const isPublicRoute = publicPaths.some(
    (path) => to.path === path || to.path.startsWith("/auth/"),
  )

  if (isPublicRoute) {
    return
  }

  // Витрины дизайн-системы (/_ui, /_shell): только в dev, данных не показывают.
  // Удаляются вместе со страницами в этапе 7 перед мержем.
  if (import.meta.dev && to.path.startsWith("/_")) {
    return
  }

  const { loggedIn } = useUserSession()

  if (!loggedIn.value) {
    return navigateTo("/auth/login")
  }
})
