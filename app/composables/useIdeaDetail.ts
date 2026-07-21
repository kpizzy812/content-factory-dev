import type { ReferenceProgress } from '~~/shared/types/reference'

/**
 * Composable для получения детальной информации об идее с автоматическим
 * polling пока reference-анализ в статусе running.
 *
 * Возвращает дополнительно `progress` — распарсенный ReferenceProgress из
 * Idea.analysisProgress для отображения стадий анализа в UI.
 */
export function useIdeaDetail(id: Ref<number | string> | ComputedRef<number | string>) {
  const fetchResult = useFetch(`/api/ideas/${unref(id)}` as '/api/ideas/:id', {
    watch: [id],
  })

  // Парсим прогресс из строки в Idea.analysisProgress
  const progress = computed<ReferenceProgress | null>(() => {
    const raw = fetchResult.data.value?.data?.analysisProgress
    if (!raw || typeof raw !== 'string') return null
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && typeof parsed.stage === 'string') {
        return parsed as ReferenceProgress
      }
    }
    catch { /* malformed JSON — игнорируем */ }
    return null
  })

  // Polling 3с пока анализ выполняется
  const POLL_INTERVAL_MS = 3000
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function startPolling() {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      const status = fetchResult.data.value?.data?.referenceStatus
      if (status === 'running') {
        fetchResult.refresh()
      }
      else {
        stopPolling()
      }
    }, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onMounted(() => {
    // Сразу запускаем polling если уже running
    if (fetchResult.data.value?.data?.referenceStatus === 'running') {
      startPolling()
    }
    // И следим за изменениями статуса
    watch(
      () => fetchResult.data.value?.data?.referenceStatus,
      (status) => {
        if (status === 'running') startPolling()
        else stopPolling()
      },
    )
  })

  onUnmounted(() => {
    stopPolling()
  })

  return { ...fetchResult, progress }
}
