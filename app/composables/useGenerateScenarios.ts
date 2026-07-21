export function useGenerateScenarios() {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)

  async function generate(trendId: number, variantsCount?: number, profileId?: number | null) {
    isGenerating.value = true
    error.value = null

    try {
      const result = await $fetch('/api/scenarios/generate', {
        method: 'POST',
        body: { trendId, variantsCount, profileId: profileId || undefined },
      })
      return result
    } catch (e: unknown) {
      const message =
        (e as { data?: { message?: string } })?.data?.message
        ?? (e instanceof Error ? e.message : 'Неизвестная ошибка')
      error.value = message
      return null
    } finally {
      isGenerating.value = false
    }
  }

  return { isGenerating, error, generate }
}
