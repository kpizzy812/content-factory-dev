/**
 * Track F — список уникализированных вариантов для видео.
 *
 * server: false — секция отображается только в UI после mount;
 * key реактивно зависит от videoId, чтобы корректно перефетчить
 * при переходе между видео без полного refresh.
 */

interface VariantDto {
  id: string
  platform: 'tiktok' | 'instagram' | 'youtube'
  paramsHash: string
  paramsJson: {
    crf: number
    brightness: number
    contrast: number
    saturation: number
    speed: number
    cropPx: number
    randomSeed: string
  }
  filePath: string
  fileUrl: string
  fileHash: string
  durationSec: number
  fileSize: number
  createdAt: string
}

export function useVideoVariants(videoId: MaybeRefOrGetter<number | string>) {
  const id = computed(() => toValue(videoId))
  return useFetch<{ data: VariantDto[] }>(() => `/api/videos/${id.value}/variants`, {
    key: () => `video-variants-${id.value}`,
    server: false,
    default: () => ({ data: [] }),
    watch: [id],
  })
}

export type { VariantDto }
