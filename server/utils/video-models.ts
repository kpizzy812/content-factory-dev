/**
 * Curated Model Registry для video generation.
 *
 * Единственный source of truth для доступных моделей,
 * их параметров, ценообразования и ограничений.
 * Обновлять только здесь.
 */

// ─── Типы ──────────────────────────────────────────

export type ModelTask = "image" | "video" | "music" | "tts" | "lip_sync"
export type BillingUnit = "megapixel" | "second" | "video" | "track" | "character" | "audio_second"

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

// ─── Реестр моделей ────────────────────────────────

export const IMAGE_MODELS: ModelMeta[] = [
  {
    id: "fal-ai/flux/schnell",
    name: "FLUX.1 Schnell",
    task: "image",
    provider: "Black Forest Labs",
    pricing: { unit: "megapixel", base: 0.003 },
    resolutions: ["1024x1024", "1080x1920", "1920x1080"],
    strengths: [
      "Самая быстрая генерация (~0.3с)",
      "В 8x дешевле FLUX Dev",
      "Хорошее качество для черновиков",
    ],
    tradeoffs: [
      "Меньше деталей, чем FLUX Dev",
      "Max 4 inference steps",
    ],
    avgGenerationTime: "~0.4 сек",
    integrated: true,
    tier: "budget",
  },
  {
    id: "fal-ai/flux/dev",
    name: "FLUX.1 Dev",
    task: "image",
    provider: "Black Forest Labs",
    pricing: { unit: "megapixel", base: 0.025 },
    resolutions: ["1024x1024", "1080x1920", "1920x1080"],
    strengths: [
      "Высокое качество (12B параметров)",
      "Хорошая детализация и adherence к промпту",
      "Стабильные результаты",
    ],
    tradeoffs: [
      "Дороже FLUX Schnell в 8x",
      "Медленнее (~2 сек)",
    ],
    avgGenerationTime: "~2 сек",
    integrated: true,
    tier: "standard",
  },
]

export const VIDEO_MODELS: ModelMeta[] = [
  {
    id: "fal-ai/kling-video/v3/standard/text-to-video",
    name: "Kling 3.0 Standard",
    task: "video",
    provider: "Kuaishou",
    pricing: {
      unit: "second",
      base: 0.084,
      withAudio: 0.126,
    },
    resolutions: ["1920x1080", "1080x1920", "1080x1080"],
    durationRange: [3, 15],
    strengths: [
      "До 15 сек видео",
      "Встроенная генерация аудио",
      "Хорошая кинематографичность",
      "Подключён к pipeline",
    ],
    tradeoffs: [
      "Долгая генерация (5–15 мин)",
      "Дороже Hailuo Standard",
    ],
    avgGenerationTime: "5–15 мин",
    integrated: true,
    tier: "standard",
  },
  {
    id: "fal-ai/kling-video/v3/pro/text-to-video",
    name: "Kling 3.0 Pro",
    task: "video",
    provider: "Kuaishou",
    pricing: {
      unit: "second",
      base: 0.112,
      withAudio: 0.168,
    },
    resolutions: ["1920x1080", "1080x1920", "1080x1080"],
    durationRange: [3, 15],
    strengths: [
      "Максимальное качество видео",
      "Лучшая кинематографичность",
      "Встроенная генерация аудио",
    ],
    tradeoffs: [
      "На 33% дороже Standard",
      "Ещё более долгая генерация",
    ],
    avgGenerationTime: "8–20 мин",
    integrated: false,
    tier: "premium",
  },
  {
    id: "fal-ai/wan/v2.2-a14b/text-to-video",
    name: "Wan 2.2 (a14b)",
    task: "video",
    provider: "Alibaba / fal.ai",
    pricing: {
      // 720p — наш default. 580p = $0.06, 480p = $0.04 (для super-budget путём
      // resolution override в payload). Wan не имеет встроенного аудио — поэтому
      // withAudio отсутствует. Считается per video-second.
      unit: "second",
      base: 0.08,
      byResolution: {
        "480p": 0.04,
        "580p": 0.06,
        "720p": 0.08,
      },
    },
    resolutions: ["480p", "580p", "720p"],
    durationOptions: [3, 5, 7, 10],
    strengths: [
      "Лучшая цена на 480p ($0.04/сек)",
      "Быстрая генерация (≤ 3 мин)",
      "Самостоятельный визуальный стиль (Alibaba Wan)",
      "Поддерживает 9:16 / 16:9 / 1:1",
    ],
    tradeoffs: [
      "Только 720p max (без 1080p)",
      "Без встроенного аудио (используйте TTS + музыку)",
      "Меньше cinematic quality чем Kling Pro",
    ],
    avgGenerationTime: "1-3 мин",
    integrated: true,
    tier: "budget",
  },
  {
    id: "fal-ai/minimax/hailuo-02/standard/text-to-video",
    name: "Hailuo-02 Standard",
    task: "video",
    provider: "MiniMax",
    pricing: {
      unit: "second",
      base: 0.045,
    },
    resolutions: ["768p"],
    durationOptions: [5, 10],
    strengths: [
      "Самый дешёвый вариант",
      "Быстрая генерация",
    ],
    tradeoffs: [
      "Только 768p разрешение",
      "Только 5 или 10 сек",
      "Не подключён к pipeline",
    ],
    avgGenerationTime: "2–5 мин",
    integrated: false,
    tier: "budget",
  },
]

/**
 * TTS (text-to-speech) модели.
 * Используются для синтеза voiceover из StoryPlan.voiceoverPlan.lines.
 * Все провайдеры проксированы через fal.ai (используют существующий FAL_KEY).
 */
export const TTS_MODELS: ModelMeta[] = [
  {
    id: "fal-ai/kokoro/american-english",
    name: "Kokoro (American English)",
    task: "tts",
    provider: "Hexgrad / fal.ai",
    pricing: {
      unit: "audio_second",
      base: 0.00025, // примерно $0.015 за минуту
    },
    strengths: [
      "Open-source, самый дешёвый TTS",
      "Быстрая синтез (~2-3x realtime)",
      "Естественная интонация на английском",
      "Множество голосов (male/female)",
    ],
    tradeoffs: [
      "Только американский английский",
      "Ограниченный emotional range",
    ],
    avgGenerationTime: "~3-5 сек на фразу",
    integrated: true,
    tier: "budget",
  },
  {
    id: "fal-ai/kokoro/russian",
    name: "Kokoro (Russian)",
    task: "tts",
    provider: "Hexgrad / fal.ai",
    pricing: {
      unit: "audio_second",
      base: 0.00025,
    },
    strengths: [
      "Русский TTS, open-source",
      "Быстрая синтез",
    ],
    tradeoffs: [
      "Менее естественный чем ElevenLabs",
      "Ограниченный набор голосов",
    ],
    avgGenerationTime: "~3-5 сек",
    integrated: true,
    tier: "budget",
  },
  {
    id: "fal-ai/playai/tts/v3",
    name: "PlayAI TTS v3",
    task: "tts",
    provider: "PlayAI / fal.ai",
    pricing: {
      unit: "character",
      base: 0.00003, // ~$0.03 за 1000 символов
    },
    strengths: [
      "Высокое качество голоса",
      "Expressive эмоциональная окраска",
      "Multiple languages",
    ],
    tradeoffs: [
      "Дороже Kokoro в 3-5x",
    ],
    avgGenerationTime: "~5-10 сек",
    integrated: true,
    tier: "standard",
  },
  {
    id: "fal-ai/elevenlabs/tts/turbo-v2.5",
    name: "ElevenLabs Turbo v2.5",
    task: "tts",
    provider: "ElevenLabs / fal.ai",
    pricing: {
      unit: "character",
      base: 0.00015, // ElevenLabs premium pricing
    },
    strengths: [
      "Максимальное качество голоса",
      "Emotional range и character continuity",
      "29 языков",
      "Low latency (turbo)",
    ],
    tradeoffs: [
      "Самый дорогой TTS вариант",
      "Требует доступ ElevenLabs через fal",
    ],
    avgGenerationTime: "~2-4 сек",
    integrated: true,
    tier: "premium",
  },
]

export const LIP_SYNC_MODELS: ModelMeta[] = [
  {
    id: "fal-ai/sync-lipsync",
    name: "Sync Lipsync v1",
    task: "lip_sync",
    provider: "Sync.so / fal.ai",
    pricing: {
      // Биллинг fal.ai per second of OUTPUT video. Реальная цена смотрится
      // на странице модели в fal.ai dashboard, текущая оценка ~$0.067.
      unit: "second",
      base: 0.067,
    },
    strengths: [
      "Sync video с произвольным аудио",
      "Работает с готовыми клипами Kling",
      "Сохраняет original facial expression",
    ],
    tradeoffs: [
      "+~$0.07 за каждую секунду lip-synced сцены",
      "Требует TTS для генерации голоса персонажа",
    ],
    avgGenerationTime: "~30-60 сек на сцену",
    integrated: true,
    tier: "premium",
  },
]

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

  // Russian-specific path
  if (lang.startsWith('ru')) {
    const ruKokoro = integrated.find(m => m.id === 'fal-ai/kokoro/russian')
    if (ruKokoro) return ruKokoro
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
