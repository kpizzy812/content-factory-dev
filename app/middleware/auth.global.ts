export default defineNuxtRouteMiddleware((to) => {
  // Явный whitelist публичных маршрутов для предотвращения бесконечного редиректа
  const publicPaths = ["/auth/login", "/auth"]

  const isPublicRoute = publicPaths.some(
    (path) => to.path === path || to.path.startsWith("/auth/"),
  )

  if (isPublicRoute) {
    return
  }

  const { loggedIn } = useUserSession()

  if (!loggedIn.value) {
    return navigateTo("/auth/login")
  }
})
