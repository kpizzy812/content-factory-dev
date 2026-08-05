export default defineNuxtRouteMiddleware((to) => {
  // Явный whitelist публичных маршрутов для предотвращения бесконечного редиректа
  const publicPaths = ["/auth/login", "/auth"]

  const isPublicRoute = publicPaths.some(
    (path) => to.path === path || to.path.startsWith("/auth/"),
  )

  if (isPublicRoute) {
    return
  }

  // Витрина дизайн-системы: только в dev, данных не показывает.
  // Удаляется вместе со страницей в этапе 7 перед мержем.
  if (import.meta.dev && to.path === "/_ui") {
    return
  }

  const { loggedIn } = useUserSession()

  if (!loggedIn.value) {
    return navigateTo("/auth/login")
  }
})
