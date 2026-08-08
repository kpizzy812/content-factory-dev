/**
 * Client-only plugin: перехватывает 401 ответы от $fetch,
 * сбрасывает stale session и редиректит на логин.
 *
 * Без этого плагина после инвалидации cookie (истёк срок, вход с другого
 * устройства) UI остаётся "залогиненным", а запросы молча падают.
 */
export default defineNuxtPlugin(() => {
  const { clear } = useUserSession()
  const router = useRouter()

  globalThis.$fetch = new Proxy(globalThis.$fetch, {
    async apply(target, thisArg, args) {
      try {
        return await Reflect.apply(target, thisArg, args)
      } catch (error: any) {
        if (error?.response?.status === 401 || error?.statusCode === 401) {
          const currentPath = router.currentRoute.value.path
          if (!currentPath.startsWith('/auth')) {
            await clear()
            await navigateTo('/auth/login')
          }
        }
        throw error
      }
    },
  })
})
