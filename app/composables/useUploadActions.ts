interface CreateUploadsParams {
  videoId: number
  accountIds?: number[]
  groupId?: number
  title: string
  description?: string
  hashtags?: string[]
  scheduledAt?: string
}

export function useUploadActions() {
  const isCreating = ref(false)
  const isRetrying = ref(false)
  const error = ref<string | null>(null)

  async function createUploads(params: CreateUploadsParams) {
    isCreating.value = true
    error.value = null

    try {
      const result = await $fetch('/api/uploads/create', {
        method: 'POST',
        body: params,
      })
      return result
    } catch (e: unknown) {
      const message =
        (e as { data?: { message?: string } })?.data?.message
        ?? (e instanceof Error ? e.message : 'Неизвестная ошибка')
      error.value = message
      return null
    } finally {
      isCreating.value = false
    }
  }

  async function retryUpload(id: number) {
    isRetrying.value = true
    error.value = null

    try {
      const result = await $fetch(`/api/uploads/${id}/retry`, {
        method: 'POST',
      })
      return result
    } catch (e: unknown) {
      const message =
        (e as { data?: { message?: string } })?.data?.message
        ?? (e instanceof Error ? e.message : 'Неизвестная ошибка')
      error.value = message
      return null
    } finally {
      isRetrying.value = false
    }
  }

  return { createUploads, retryUpload, isCreating, isRetrying, error }
}
