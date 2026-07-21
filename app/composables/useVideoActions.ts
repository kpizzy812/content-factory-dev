export function useVideoActions() {
  const toast = useToast()
  const isGenerating = ref(false)
  const isDeleting = ref(false)
  const isCanceling = ref(false)
  const isResuming = ref(false)
  const isRerunning = ref(false)
  const error = ref<string | null>(null)

  function extractError(e: unknown): string {
    return (e as { data?: { message?: string } })?.data?.message
      ?? (e instanceof Error ? e.message : 'Неизвестная ошибка')
  }

  function reportError(action: string, e: unknown) {
    const msg = extractError(e)
    error.value = msg
    toast.error(`${action}: ${msg}`)
  }

  async function generateVideo(scenarioId: number, options: {
    format?: string
    subtitlesEnabled?: boolean
    musicEnabled?: boolean
    musicMood?: string
    musicDuration?: number
    musicVolume?: number
    musicVolumeWithVoiceover?: number
    clipDuration?: number
    imageCount?: number
    renderQuality?: string
    targetPlatform?: string
    imageModelId?: string
    videoModelId?: string
    modelStrategy?: string
    generateAudio?: boolean
    voiceoverEnabled?: boolean
    voiceoverModelId?: string | null
    voiceoverVoiceId?: string | null
    voiceoverLanguage?: string
    voiceoverPacing?: string
    voiceoverReconciliation?: string
  } = {}) {
    isGenerating.value = true
    error.value = null

    try {
      const result = await $fetch('/api/videos/generate', {
        method: 'POST',
        body: {
          scenarioId,
          format: options.format || 'portrait',
          subtitlesEnabled: options.subtitlesEnabled,
          musicEnabled: options.musicEnabled,
          musicMood: options.musicMood,
          musicDuration: options.musicDuration,
          musicVolume: options.musicVolume,
          musicVolumeWithVoiceover: options.musicVolumeWithVoiceover,
          clipDuration: options.clipDuration,
          imageCount: options.imageCount,
          renderQuality: options.renderQuality,
          targetPlatform: options.targetPlatform,
          imageModelId: options.imageModelId,
          videoModelId: options.videoModelId,
          modelStrategy: options.modelStrategy,
          generateAudio: options.generateAudio,
          voiceoverEnabled: options.voiceoverEnabled,
          voiceoverModelId: options.voiceoverModelId,
          voiceoverVoiceId: options.voiceoverVoiceId,
          voiceoverLanguage: options.voiceoverLanguage,
          voiceoverPacing: options.voiceoverPacing,
          voiceoverReconciliation: options.voiceoverReconciliation,
        },
      })
      return result
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isGenerating.value = false
    }
  }

  async function deleteVideo(videoId: number) {
    isDeleting.value = true
    error.value = null

    try {
      const result = await $fetch(`/api/videos/${videoId}`, {
        method: 'DELETE',
      })
      toast.success('Видео удалено')
      return result
    } catch (e: unknown) {
      reportError('Не удалось удалить видео', e)
      return null
    } finally {
      isDeleting.value = false
    }
  }

  async function cancelVideo(videoId: number) {
    isCanceling.value = true
    error.value = null

    try {
      const result = await $fetch(`/api/videos/${videoId}/cancel`, {
        method: 'POST',
      })
      toast.info('Запрос на отмену отправлен')
      return result
    } catch (e: unknown) {
      reportError('Не удалось отменить', e)
      return null
    } finally {
      isCanceling.value = false
    }
  }

  async function resumeVideo(videoId: number) {
    isResuming.value = true
    error.value = null

    try {
      const result = await $fetch(`/api/videos/${videoId}/resume`, {
        method: 'POST',
      })
      return result
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isResuming.value = false
    }
  }

  async function rerunStep(videoId: number, stepKey: string) {
    isRerunning.value = true
    error.value = null

    try {
      const result = await $fetch(`/api/videos/${videoId}/rerun-step`, {
        method: 'POST',
        body: { stepKey },
      })
      return result
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isRerunning.value = false
    }
  }

  const isSkipping = ref(false)

  async function skipStep(videoId: number, stepKey: string) {
    isSkipping.value = true
    error.value = null

    try {
      const result = await $fetch(`/api/videos/${videoId}/skip-step`, {
        method: 'POST',
        body: { stepKey },
      })
      return result
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isSkipping.value = false
    }
  }

  return {
    generateVideo,
    deleteVideo,
    cancelVideo,
    resumeVideo,
    rerunStep,
    skipStep,
    isGenerating,
    isDeleting,
    isCanceling,
    isResuming,
    isRerunning,
    isSkipping,
    error,
  }
}
