/**
 * Captions: per-platform метаданные для публикации видео.
 * Один Caption = (videoId, platform). Создаётся CaptionGenerator-нодой
 * pipeline'а (или вручную) и подменяет placeholder title/description/hashtags
 * в Upload при approve.
 *
 * Лимиты платформ (см. caption-limits.ts):
 *   TikTok      title ≤ 150, hashtags budget 100 chars (с # и пробелами), 5 тегов
 *   YouTube     title ≤ 100, hashtags budget 500 chars, до 15 тегов
 *   Instagram   title ≤ 125, hashtags budget 100 chars, до 30 тегов
 */

export type SocialPlatform = 'tiktok' | 'youtube' | 'instagram'

export interface PlatformLimits {
  /** Максимальная длина title (символы) */
  titleMaxChars: number
  /** Суммарный бюджет hashtags с префиксом # и пробелами между */
  hashtagsMaxBudget: number
  /** Опциональный max count тегов */
  hashtagsMaxCount?: number
}

export interface PlatformCaption {
  platform: SocialPlatform
  /** Основной заголовок (для TikTok = caption под видео) */
  title: string
  /** Описание (YouTube/Instagram). Для TikTok может дублировать title. */
  description?: string
  /** Теги без префикса # */
  hashtags: string[]

  /** Лимиты платформы — для отрисовки счётчиков в UI */
  limits: PlatformLimits

  /** Укладывается ли в лимиты (вычисляется validateCaption из caption-limits.ts) */
  fitsLimits: boolean
  /** Список ошибок если fitsLimits=false */
  validationErrors?: string[]
}

export interface CaptionGeneratorOutput {
  videoId: number
  scenarioId?: number

  captions: {
    tiktok?: PlatformCaption
    youtube?: PlatformCaption
    instagram?: PlatformCaption
  }

  /** Источники контекста, фактически использованные при генерации */
  contextUsed: {
    storyPlan: boolean
    appContext: boolean
    sceneFrames: boolean
    favoritePrompts: boolean
  }

  modelVersion: string
  generatedAt: string
}

/**
 * Снимок Caption для UI (без relations). Совпадает с Prisma model
 * полями для фронта — формируется на endpoint'ах.
 */
export interface CaptionSnapshot {
  id: string
  videoId: number
  platform: SocialPlatform
  title: string
  description: string | null
  hashtags: string[]
  charsTitle: number
  charsHashtagsTotal: number
  fitsLimits: boolean
  modelVersion: string
  promptVersion: string
  generationCost: number | null
  runId: number | null
  pipelineId: number | null
  approvedAt: string | null
  approvedById: number | null
  createdAt: string
  updatedAt: string
}
