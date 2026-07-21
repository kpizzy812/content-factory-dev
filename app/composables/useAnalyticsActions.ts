export function useAnalyticsActions() {
  const isCollecting = ref(false)
  const isAnalyzing = ref(false)
  const collectError = ref<string | null>(null)
  const analyzeError = ref<string | null>(null)

  const collectResult = ref<{ collected: number; errorsCount: number } | null>(null)
  interface AnalysisResponse {
    reason: string
    analysis: string
    recommendations: string[]
    isSuccessful: boolean
  }
  const analyzeResult = ref<{ analysis: AnalysisResponse; referenceCreated: boolean } | null>(null)

  async function collectMetrics(uploadIds?: number[]) {
    isCollecting.value = true
    collectError.value = null
    collectResult.value = null

    try {
      const res = await $fetch('/api/analytics/collect', {
        method: 'POST',
        body: uploadIds ? { uploadIds } : {},
      })
      collectResult.value = {
        collected: res.data.collected,
        errorsCount: res.data.errorsCount,
      }
      return res.data
    } catch (e: unknown) {
      const message =
        (e as { data?: { message?: string } })?.data?.message
        ?? (e instanceof Error ? e.message : 'Неизвестная ошибка')
      collectError.value = message
      return null
    } finally {
      isCollecting.value = false
    }
  }

  async function analyzePost(uploadId: number) {
    isAnalyzing.value = true
    analyzeError.value = null
    analyzeResult.value = null

    try {
      const res = await $fetch(`/api/analytics/analyze/${uploadId}`, {
        method: 'POST',
      })
      analyzeResult.value = {
        analysis: res.data.analysis,
        referenceCreated: res.data.referenceCreated,
      }
      return res.data
    } catch (e: unknown) {
      const message =
        (e as { data?: { message?: string } })?.data?.message
        ?? (e instanceof Error ? e.message : 'Неизвестная ошибка')
      analyzeError.value = message
      return null
    } finally {
      isAnalyzing.value = false
    }
  }

  return {
    collectMetrics,
    analyzePost,
    isCollecting,
    isAnalyzing,
    collectError,
    analyzeError,
    collectResult,
    analyzeResult,
  }
}
