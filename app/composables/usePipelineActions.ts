export function usePipelineActions() {
  const isSaving = ref(false)
  const isDeleting = ref(false)
  const error = ref<string | null>(null)

  async function createPipeline(name: string, description?: string) {
    error.value = null
    try {
      return await $fetch('/api/pipelines', {
        method: 'POST',
        body: { name, description },
      })
    } catch (e: any) {
      error.value = e?.data?.message || 'Ошибка создания конвейера'
      throw e
    }
  }

  async function savePipeline(id: number, data: Record<string, unknown>) {
    error.value = null
    isSaving.value = true
    try {
      return await $fetch(`/api/pipelines/${id}`, {
        method: 'PUT',
        body: data,
      })
    } catch (e: any) {
      error.value = e?.data?.message || 'Ошибка сохранения конвейера'
      throw e
    } finally {
      isSaving.value = false
    }
  }

  async function deletePipeline(id: number) {
    error.value = null
    isDeleting.value = true
    try {
      return await $fetch(`/api/pipelines/${id}`, {
        method: 'DELETE',
      })
    } catch (e: any) {
      error.value = e?.data?.message || 'Ошибка удаления конвейера'
      throw e
    } finally {
      isDeleting.value = false
    }
  }

  return { createPipeline, savePipeline, deletePipeline, isSaving, isDeleting, error }
}
