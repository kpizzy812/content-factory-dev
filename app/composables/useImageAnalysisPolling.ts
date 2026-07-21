import type { Ref } from 'vue'

/**
 * Универсальный polling для AI vision анализа изображений (character refs, scene refs).
 * Пока в `items` есть элементы без `aiAnalyzedAt` и без `aiError` — каждый `intervalMs`
 * вызывает `refresh()`. Как только все обработаны или у всех есть ошибка — таймер
 * останавливается. Авто-cleanup при unmount.
 *
 * Прежняя реализация дублировалась в CharacterReferenceUploader и SceneReferenceUploader
 * (один и тот же 16-строчный шаблон). Этот composable — единственный источник истины.
 */
export function useImageAnalysisPolling<T extends { aiAnalyzedAt: Date | string | null, aiError: string | null }>(options: {
  items: Ref<T[]>
  refresh: () => Promise<void>
  intervalMs?: number
}) {
  const intervalMs = options.intervalMs ?? 4000
  const hasPending = computed(() => options.items.value.some((r) => !r.aiAnalyzedAt && !r.aiError))

  let pollTimer: ReturnType<typeof setInterval> | null = null

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  watch(hasPending, (pending) => {
    if (pending && !pollTimer) {
      pollTimer = setInterval(() => { options.refresh() }, intervalMs)
    } else if (!pending) {
      stopPolling()
    }
  }, { immediate: true })

  onUnmounted(() => { stopPolling() })

  return { hasPending, stopPolling }
}
