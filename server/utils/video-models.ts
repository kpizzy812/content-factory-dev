/**
 * Витрина моделей для UI и сметы.
 *
 * Source of truth для медиамоделей — реестр спек
 * `server/utils/media-provider/model-specs.ts`: там лежат id, провайдер, цена,
 * маппер входа и разбор выхода. Здесь из спек собирается прежний плоский
 * `ModelMeta`, которым пользуются десятки мест (смета, API моделей, фронт).
 *
 * Что это чинит: цена lip-sync $0.014 была продублирована здесь и в реестре
 * media-provider, равенство держалось вручную и ничем не проверялось.
 *
 * Новую медиамодель добавлять В РЕЕСТР СПЕК, не сюда. Здесь остаётся только
 * музыка: Mubert — не медиаспособность нового контура (свой HTTP-клиент,
 * отдельный биллинг за трек), и в MediaCapability его нет.
 */

import { listMediaSpecs } from "./media-provider/registry"
import type { MediaBilling, MediaCapability, MediaModelSpec } from "./media-provider/types"

// ─── Типы ──────────────────────────────────────────

export type ModelTask = "image" | "video" | "music" | "tts" | "lip_sync"
export type BillingUnit =
  | "megapixel"
  | "second"
  | "video"
  | "track"
  | "character"
  | "audio_second"
  // Единицы новых спек: за изображение, за секунду железа и фиксированная цена.
  // Появляются вместе с моделями Replicate, у fal-моделей не встречаются.
  | "image"
  | "hardware_second"
  | "flat"
  // Fish Audio считает по UTF-8 байтам: кириллица это два байта на букву,
  // и показывать её цену «за символ» значило бы занижать вдвое.
  | "utf8_byte"

export interface ModelPricing {
  unit: BillingUnit
  /** Цена за единицу (для image — per megapixel, для video — per second) */
  base: number
  /** Дополнительная цена за аудио (video models) */
  withAudio?: number
  /** Цены по разрешению (если зависит) */
  byResolution?: Record<string, number>
}

export interface ModelMeta {
  /** Уникальный ключ модели (fal.ai endpoint) */
  id: string
  /** Человекочитаемое название */
  name: string
  /** Тип задачи */
  task: ModelTask
  /** Провайдер */
  provider: string
  /** Ценообразование */
  pricing: ModelPricing
  /** Поддерживаемые разрешения / aspect ratios */
  resolutions?: string[]
  /** Диапазон длительности (только для video) */
  durationRange?: [number, number]
  /** Фиксированные опции длительности (если нет диапазона) */
  durationOptions?: number[]
  /** Сильные стороны */
  strengths: string[]
  /** Компромиссы */
  tradeoffs: string[]
  /** Среднее время генерации */
  avgGenerationTime?: string
  /** Доступен ли в проекте (подключён к pipeline) */
  integrated: boolean
  /** Категория качества для UI */
  tier: "budget" | "standard" | "premium"
}

// ─── Сборка витрины из спек ────────────────────────

/**
 * Какая способность реестра попадает в витрину и под каким `task`.
 *
 * `image_to_video` здесь нет намеренно: это не выбираемая пользователем модель,
 * а маршрут сцен со скриншотом приложения. Её endpoint был константой в шаге и
 * в реестре моделей не значился — селекторы UI её не показывали и не должны
 * начать показывать из-за появления спеки.
 */
const CAPABILITY_TASKS: Partial<Record<MediaCapability, ModelTask>> = {
  text_to_image: "image",
  text_to_video: "video",
  text_to_speech: "tts",
  lip_sync: "lip_sync",
}

/** Единица биллинга спеки → прежняя плоская форма ModelPricing для UI и сметы. */
function toPricing(billing: MediaBilling): ModelPricing {
  switch (billing.unit) {
    case "output_megapixel":
      return { unit: "megapixel", base: billing.usdPerMegapixel }
    case "output_second": {
      const pricing: ModelPricing = { unit: "second", base: billing.usdPerSecond }
      if (billing.usdPerSecondWithAudio !== undefined) pricing.withAudio = billing.usdPerSecondWithAudio
      if (billing.byResolution) pricing.byResolution = { ...billing.byResolution }
      return pricing
    }
    case "audio_second":
      return { unit: "audio_second", base: billing.usdPerSecond }
    case "character":
      return { unit: "character", base: billing.usdPerCharacter }
    case "utf8_byte":
      return { unit: "utf8_byte", base: billing.usdPerByte }
    case "output_image":
      return { unit: "image", base: billing.usdPerImage }
    case "hardware_second":
      // Цена известна только после завершения задачи — в витрине это оценка.
      return { unit: "hardware_second", base: billing.usdPerSecond }
    case "flat":
      return { unit: "flat", base: billing.usd }
  }
}

function toModelMeta(spec: MediaModelSpec): ModelMeta {
  const task = CAPABILITY_TASKS[spec.capability]
  if (!task) {
    throw new Error(`Способность ${spec.capability} не имеет представления в витрине моделей`)
  }

  const meta: ModelMeta = {
    id: spec.id,
    name: spec.name,
    task,
    // provider витрины — человекочитаемый вендор ("Kuaishou"), а не имя API.
    provider: spec.vendorLabel,
    pricing: toPricing(spec.billing),
    strengths: [...spec.strengths],
    tradeoffs: [...spec.tradeoffs],
    integrated: spec.integrated,
    tier: spec.tier,
  }

  const constraints = spec.constraints as {
    resolutions?: readonly string[]
    durationRange?: readonly [number, number]
    durationOptions?: readonly number[]
  }
  if (constraints.resolutions) meta.resolutions = [...constraints.resolutions]
  if (constraints.durationRange) {
    meta.durationRange = [constraints.durationRange[0], constraints.durationRange[1]]
  }
  if (constraints.durationOptions) meta.durationOptions = [...constraints.durationOptions]
  if (spec.avgGenerationTime) meta.avgGenerationTime = spec.avgGenerationTime

  return meta
}

/** Порядок спек способности сохраняется: от него зависят дефолты пайплайна. */
function buildShowcase(capability: MediaCapability): ModelMeta[] {
  return listMediaSpecs(capability).map(toModelMeta)
}

export const IMAGE_MODELS: ModelMeta[] = buildShowcase("text_to_image")

export const VIDEO_MODELS: ModelMeta[] = buildShowcase("text_to_video")

/**
 * TTS (text-to-speech) модели.
 * Используются для синтеза voiceover из StoryPlan.voiceoverPlan.lines.
 * Все провайдеры проксированы через fal.ai (используют существующий FAL_KEY).
 */
export const TTS_MODELS: ModelMeta[] = buildShowcase("text_to_speech")

export const LIP_SYNC_MODELS: ModelMeta[] = buildShowcase("lip_sync")

export const MUSIC_MODELS: ModelMeta[] = [
  {
    id: "mubert",
    name: "Mubert AI",
    task: "music",
    provider: "Mubert",
    pricing: {
      unit: "track",
      base: 0.04, // Startup: $199/5000 = ~$0.04
    },
    strengths: [
      "Text-to-music генерация",
      "Коммерческая лицензия",
      "Подбор по настроению",
    ],
    tradeoffs: [
      "Требует подписку ($49–$199/мес)",
      "Нет pay-per-use",
    ],
    integrated: true,
    tier: "standard",
  },
]

// ─── Lookup ────────────────────────────────────────

const ALL_MODELS = [...IMAGE_MODELS, ...VIDEO_MODELS, ...MUSIC_MODELS, ...TTS_MODELS, ...LIP_SYNC_MODELS]
const MODEL_MAP = new Map(ALL_MODELS.map(m => [m.id, m]))

export function getModel(id: string): ModelMeta | undefined {
  return MODEL_MAP.get(id)
}

export function getModelsByTask(task: ModelTask): ModelMeta[] {
  return ALL_MODELS.filter(m => m.task === task)
}

export function getIntegratedModels(): ModelMeta[] {
  return ALL_MODELS.filter(m => m.integrated)
}

/** Модель изображений по умолчанию */
export function getDefaultImageModel(): ModelMeta {
  return IMAGE_MODELS.find(m => m.integrated) ?? IMAGE_MODELS[0]!
}

/** Модель видео по умолчанию */
export function getDefaultVideoModel(): ModelMeta {
  return VIDEO_MODELS.find(m => m.integrated) ?? VIDEO_MODELS[0]!
}

/** TTS модель по умолчанию (integrated) */
export function getDefaultTtsModel(): ModelMeta | null {
  return TTS_MODELS.find(m => m.integrated) ?? null
}

/** Lip-sync модель по умолчанию (integrated) */
export function getDefaultLipSyncModel(): ModelMeta | null {
  return LIP_SYNC_MODELS.find(m => m.integrated) ?? null
}

/** Выбрать TTS модель по языку и tier (budget/standard/premium) */
export function pickTtsModel(options: {
  language?: string
  tier?: 'budget' | 'standard' | 'premium'
  preferredId?: string | null
}): ModelMeta | null {
  if (options.preferredId) {
    const m = getModel(options.preferredId)
    if (m && m.task === 'tts') return m
  }
  const lang = (options.language || 'en').toLowerCase()
  const integrated = TTS_MODELS.filter(m => m.integrated)
  if (integrated.length === 0) return null

  // Русский: только модели, которые его действительно произносят. Kokoro сюда
  // не подходит — у него нет русского языка, а fal-эндпоинта kokoro/russian не
  // существует вовсе (404), поэтому его спека и помечена integrated: false.
  if (lang.startsWith('ru')) {
    const minimax = integrated.find(m => m.id === 'minimax/speech-02-turbo')
    if (minimax) return minimax
    const multilingual = integrated.find(m => m.id === 'fal-ai/playai/tts/v3')
    if (multilingual) return multilingual
  }

  // Tier-based selection
  const tier = options.tier ?? 'budget'
  const byTier = integrated.find(m => m.tier === tier)
  return byTier ?? integrated[0]!
}

// ─── Model Strategy ───────────────────────────────────

/** Стратегия выбора моделей — пользовательский уровень */
export type ModelStrategy =
  | 'auto'                   // автоматически по контенту
  | 'budget'                 // минимальные затраты
  | 'fast_draft'             // черновик: быстрая генерация, компромисс по качеству
  | 'balanced'               // баланс цена/качество (default)
  | 'story_continuity'       // multi-scene continuity (story_driven)
  | 'high_realism'           // premium quality

interface ModelRecommendation {
  imageModel: ModelMeta
  videoModel: ModelMeta
  ttsModel: ModelMeta | null
  reason: string
  strategy: ModelStrategy
}

/**
 * Рекомендует модели на основе strategy.
 * Возвращает только integrated модели.
 */
export function recommendModels(
  strategy: ModelStrategy,
  options: { language?: string } = {},
): ModelRecommendation {
  const integratedImages = IMAGE_MODELS.filter(m => m.integrated)
  const integratedVideos = VIDEO_MODELS.filter(m => m.integrated)

  // Fallback если нет integrated моделей
  const defaultImg = integratedImages[0] ?? IMAGE_MODELS[0]!
  const defaultVid = integratedVideos[0] ?? VIDEO_MODELS[0]!

  const pickByTier = (models: ModelMeta[], tier: ModelMeta['tier']) =>
    models.find(m => m.tier === tier)

  switch (strategy) {
    case 'budget':
      return {
        imageModel: pickByTier(integratedImages, 'budget') ?? defaultImg,
        videoModel: pickByTier(integratedVideos, 'budget') ?? defaultVid,
        ttsModel: pickTtsModel({ language: options.language, tier: 'budget' }),
        reason: 'Самые дешёвые интегрированные модели для минимальных затрат',
        strategy,
      }

    case 'fast_draft':
      return {
        imageModel: pickByTier(integratedImages, 'budget') ?? defaultImg,
        videoModel: pickByTier(integratedVideos, 'budget') ?? defaultVid,
        ttsModel: pickTtsModel({ language: options.language, tier: 'budget' }),
        reason: 'Быстрые бюджетные модели для черновика/прототипа',
        strategy,
      }

    case 'balanced':
      return {
        imageModel: pickByTier(integratedImages, 'standard') ?? defaultImg,
        videoModel: pickByTier(integratedVideos, 'standard') ?? defaultVid,
        ttsModel: pickTtsModel({ language: options.language, tier: 'budget' }),
        reason: 'Баланс качества и стоимости: standard image/video + budget TTS',
        strategy,
      }

    case 'story_continuity':
      return {
        imageModel: pickByTier(integratedImages, 'standard') ?? defaultImg,
        videoModel: pickByTier(integratedVideos, 'standard') ?? defaultVid,
        ttsModel: pickTtsModel({ language: options.language, tier: 'standard' }),
        reason: 'Standard-tier модели для multi-scene continuity, expressive TTS',
        strategy,
      }

    case 'high_realism': {
      const premiumVid = pickByTier(integratedVideos, 'premium')
      const premiumTts = pickTtsModel({ language: options.language, tier: 'premium' })
      return {
        imageModel: pickByTier(integratedImages, 'standard') ?? defaultImg,
        videoModel: premiumVid ?? pickByTier(integratedVideos, 'standard') ?? defaultVid,
        ttsModel: premiumTts ?? pickTtsModel({ language: options.language, tier: 'standard' }),
        reason: premiumVid
          ? 'Premium video + expressive TTS для максимального качества'
          : 'Standard fallback (premium недоступна), expressive TTS',
        strategy,
      }
    }

    case 'auto':
    default:
      return {
        imageModel: pickByTier(integratedImages, 'standard') ?? defaultImg,
        videoModel: pickByTier(integratedVideos, 'standard') ?? defaultVid,
        ttsModel: pickTtsModel({ language: options.language, tier: 'budget' }),
        reason: 'Автоматический выбор: standard-tier для баланса',
        strategy: 'auto',
      }
  }
}

/**
 * Определяет рекомендуемую strategy на основе параметров контента.
 */
export function detectStrategy(params: {
  sceneCount: number
  hasStoryPlan: boolean
  maxClipDuration: number
  voiceoverEnabled?: boolean
}): ModelStrategy {
  if (params.hasStoryPlan && params.sceneCount >= 3) {
    return params.voiceoverEnabled ? 'story_continuity' : 'balanced'
  }
  if (params.sceneCount <= 2 && params.maxClipDuration <= 5) return 'fast_draft'
  return 'balanced'
}

/** @deprecated Use ModelStrategy */
export type VideoUseCase = ModelStrategy
