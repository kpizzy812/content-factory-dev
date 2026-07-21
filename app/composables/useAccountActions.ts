export function useAccountActions() {
  const isDisconnecting = ref(false)
  const error = ref<string | null>(null)

  function connectAccount(platform: string, appId: number) {
    navigateTo(`/api/social/connect/${platform}?appId=${appId}`, { external: true })
  }

  async function disconnectAccount(id: number) {
    isDisconnecting.value = true
    error.value = null

    try {
      const result = await $fetch(`/api/accounts/${id}`, {
        method: 'DELETE',
      })
      return result
    } catch (e: unknown) {
      const message =
        (e as { data?: { message?: string } })?.data?.message
        ?? (e instanceof Error ? e.message : 'Неизвестная ошибка')
      error.value = message
      return null
    } finally {
      isDisconnecting.value = false
    }
  }

  return { connectAccount, disconnectAccount, isDisconnecting, error }
}
