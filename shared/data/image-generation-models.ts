/**
 * Лёгкое зеркало `IMAGE_MODELS` из `server/utils/video-models.ts` для использования
 * на клиенте (там не подтягиваются server-only зависимости). Поля только те, что
 * нужны UI: id, человекочитаемое имя, цена за мегапиксель и человекочитаемая
 * подсказка. Сервер — единственный источник истины для биллинга; здесь дублируется
 * MINIMAL контракт для отображения "Примерно $X за генерацию" в форме.
 *
 * Если меняется тариф fal.ai — синхронизируйте оба файла.
 */
export interface ImageGenerationModelOption {
  id: 'fal-ai/flux/schnell' | 'fal-ai/flux/dev'
  name: string
  /** Цена в $ за мегапиксель (соответствует pricing.base сервера). */
  pricePerMpUsd: number
  /** Короткая подсказка для UI (скорость + качество). */
  hint: string
}

export const IMAGE_GENERATION_MODELS: ImageGenerationModelOption[] = [
  {
    id: 'fal-ai/flux/schnell',
    name: 'FLUX Schnell',
    pricePerMpUsd: 0.003,
    hint: 'Быстрая (~0.4с), базовое качество',
  },
  {
    id: 'fal-ai/flux/dev',
    name: 'FLUX Dev',
    pricePerMpUsd: 0.025,
    hint: 'Качественная (~2с), x8 дороже',
  },
]

export type ImageGenerationAspect = 'square' | 'portrait' | 'landscape'

export const IMAGE_GENERATION_ASPECTS: Array<{
  id: ImageGenerationAspect
  label: string
  width: number
  height: number
}> = [
  { id: 'square', label: 'Квадрат (1:1) — 1024×1024', width: 1024, height: 1024 },
  { id: 'portrait', label: 'Портрет (9:16) — 1024×1820', width: 1024, height: 1820 },
  { id: 'landscape', label: 'Альбом (16:9) — 1820×1024', width: 1820, height: 1024 },
]

/**
 * Считает приблизительную стоимость одной генерации в $.
 * Возвращает строку с 4 знаками после запятой (фикс scientific notation для $0.003).
 */
export function estimateImageGenerationCostUsd(modelId: string, aspect: ImageGenerationAspect): string {
  const model = IMAGE_GENERATION_MODELS.find((m) => m.id === modelId) ?? IMAGE_GENERATION_MODELS[0]!
  const aspectMeta = IMAGE_GENERATION_ASPECTS.find((a) => a.id === aspect) ?? IMAGE_GENERATION_ASPECTS[0]!
  const megapixels = (aspectMeta.width * aspectMeta.height) / 1_000_000
  const cost = megapixels * model.pricePerMpUsd
  return cost.toFixed(4)
}
