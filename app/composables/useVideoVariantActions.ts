/**
 * Track F — действия над variant'ами видео (uniqify).
 *
 * uniqifyVariant:
 *   - POST /api/videos/[id]/uniqify { platform, force? }
 *   - возвращает результат или null при ошибке (текст в error.value).
 */

interface UniqifyResult {
  filePath: string
  fileUrl: string
  fileHash: string
  fileSize: number
  durationSec: number
  paramsJson: {
    crf: number
    brightness: number
    contrast: number
    saturation: number
    speed: number
    cropPx: number
    randomSeed: string
  }
  paramsHash: string
  cached: boolean
}

interface UniqifyResponse {
  data: UniqifyResult
}

export function useVideoVariantActions() {
  const isUniqifying = ref(false)
  const error = ref<string | null>(null)

  function extractError(e: unknown): string {
    return (e as { data?: { message?: string } })?.data?.message
      ?? (e instanceof Error ? e.message : 'Неизвестная ошибка')
  }

  async function uniqifyVariant(
    videoId: number,
    platform: 'tiktok' | 'youtube',
    force = false,
  ): Promise<UniqifyResponse | null> {
    isUniqifying.value = true
    error.value = null
    try {
      const result = await $fetch<UniqifyResponse>(`/api/videos/${videoId}/uniqify`, {
        method: 'POST',
        body: { platform, force },
      })
      return result
    } catch (e) {
      error.value = extractError(e)
      return null
    } finally {
      isUniqifying.value = false
    }
  }

  return { uniqifyVariant, isUniqifying, error }
}
