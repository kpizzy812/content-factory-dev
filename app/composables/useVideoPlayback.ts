/**
 * useVideoPlayback — отдаёт свежий signed URL для воспроизведения видео.
 * GCS signed URLs short-lived (TTL ~1ч), поэтому fetch строго client-side
 * и предусмотрен явный refresh при ошибке плеера.
 *
 * Использование:
 *   const { data, refresh, pending } = await useVideoPlayback(() => props.videoId)
 *   <video :src="data?.playbackUrl ?? undefined" @error="refresh()">
 *
 * Состояния:
 *   - status='completed'|'pending'|...  + playbackUrl !== null  → плеер работает
 *   - status='legacy'                   + playbackUrl=fileUrl   → старая запись без storageKey
 *   - status='file_missing'             + playbackUrl=null      → показать alert + кнопку Re-render
 */
export interface VideoPlaybackResponse {
  videoId: number
  playbackUrl: string | null
  status: string
  expiresAt?: string
  message?: string
}

export function useVideoPlayback(videoId: MaybeRefOrGetter<number | null | undefined>) {
  return useFetch<VideoPlaybackResponse>(
    () => {
      const id = toValue(videoId)
      return id ? `/api/videos/${id}/playback-url` : ""
    },
    {
      key: () => `playback-${toValue(videoId) ?? "none"}`,
      server: false,
      immediate: false,
      watch: [() => toValue(videoId)],
    },
  )
}
