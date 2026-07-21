import type { VideoProgress } from '~~/shared/types/video'

export function useVideoProgress(videoId: Ref<number | string> | ComputedRef<number | string>) {
  const progress = ref<VideoProgress | null>(null)
  const isGenerating = ref(false)
  const isCompleted = ref(false)
  const isFailed = ref(false)
  const isCanceled = ref(false)

  let intervalId: ReturnType<typeof setInterval> | null = null

  const activeStatuses = [
    'pending', 'configuring', 'generating_prompts',
    'generating_images', 'generating_clips',
    'generating_music', 'assembling',
  ]

  async function poll() {
    try {
      const result = await $fetch<{ data: VideoProgress }>(`/api/videos/${unref(videoId)}/progress`)
      progress.value = result.data

      const status = result.data.status
      isGenerating.value = activeStatuses.includes(status)
      isCompleted.value = status === 'completed'
      isFailed.value = status === 'failed'
      isCanceled.value = status === 'canceled'

      if (isCompleted.value || isFailed.value || isCanceled.value) {
        stopPolling()
      }
    } catch {
      stopPolling()
    }
  }

  function startPolling() {
    if (intervalId) return
    poll()
    intervalId = setInterval(poll, 4000)
  }

  function stopPolling() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  onUnmounted(() => {
    stopPolling()
  })

  return {
    progress,
    isGenerating,
    isCompleted,
    isFailed,
    isCanceled,
    startPolling,
    stopPolling,
    poll,
  }
}
