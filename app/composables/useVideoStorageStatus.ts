/**
 * useVideoStorageStatus — runtime-проверка наличия физических файлов конкретного
 * видео на диске сервера. Вызывается со страницы /videos/[id] когда плеер ловит
 * 404 от /api/files/* — нужно понять что пропало (mp4 / клипы / картинки) и
 * подсказать пользователю, можно ли пересобрать без повторной (платной) генерации.
 *
 * Не использует useFetch — этот хук срабатывает реактивно после события об
 * ошибке плеера, а не при mount страницы. Один-два запроса за всю жизнь страницы.
 */
export type StorageRecoveryHint =
  | "all_present"
  | "video_missing_can_reassemble"
  | "video_missing_needs_full_regen"
  | "assets_partial"

export interface VideoStorageStatus {
  id: number
  status: string
  videoOnDisk: boolean
  videoFileUrl: string | null
  clips: { total: number; onDisk: number; missing: Array<{ id: number; order: number }> }
  images: { total: number; onDisk: number; missing: Array<{ id: number; order: number }> }
  music: { total: number; onDisk: number }
  canReassemble: boolean
  recoveryHint: StorageRecoveryHint
}

export function useVideoStorageStatus() {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const data = ref<VideoStorageStatus | null>(null)

  async function check(videoId: number): Promise<VideoStorageStatus | null> {
    isLoading.value = true
    error.value = null
    try {
      const resp = await $fetch<{ data: VideoStorageStatus }>(`/api/videos/${videoId}/storage-status`)
      data.value = resp.data
      return resp.data
    } catch (e: unknown) {
      error.value = (e as { data?: { message?: string } })?.data?.message
        ?? (e instanceof Error ? e.message : "Неизвестная ошибка")
      return null
    } finally {
      isLoading.value = false
    }
  }

  return { check, data, isLoading, error }
}
