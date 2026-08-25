/**
 * Dynamic Cost Engine для video generation.
 *
 * Считает ориентировочную стоимость по выбранным настройкам.
 * Зависит от video-models.ts как source of truth для pricing.
 */

import { getModel, getDefaultImageModel, getDefaultVideoModel, getDefaultTtsModel, getDefaultLipSyncModel, recommendModels } from "./video-models"
import type { ModelMeta } from "./video-models"
import { estimateMediaCost, findMediaSpec } from "./media-provider/registry"
import { EDIT_PLAN_MODEL_CALL_ESTIMATE_USD } from "./video-cost-actual"

// ─── Типы ──────────────────────────────────────────

export interface VideoCostConfig {
  /** ID модели изображений (fal.ai endpoint) */
  imageModelId?: string
  /** ID модели видео (fal.ai endpoint) */
  videoModelId?: string
  /** Формат видео */
  format?: "vertical" | "horizontal"
  /** Количество сцен/изображений */
  sceneCount?: number
  /** Длительность клипа в секундах (uniform — используется для legacy mode) */
  clipDuration?: number
  /** Per-scene durations (story-driven mode — если задан, clipDuration игнорируется) */
  perSceneDurations?: number[]
  /** Включено ли аудио при генерации видео */
  generateAudio?: boolean
  /** Включена ли музыка (Mubert) */
  enableMusic?: boolean
  /** Качество (влияет на разрешение изображений) */
  quality?: "720p" | "1080p"
  /** Пропустить генерацию изображений (story-driven clip-only mode) */
  skipImageGeneration?: boolean
  /** Voiceover / TTS включён */
  voiceoverEnabled?: boolean
  /** TTS модель id (если не указана — getDefaultTtsModel) */
  voiceoverModelId?: string | null
  /** Список character-count каждой voiceover line — для точного биллинга */
  voiceoverLines?: number[]
  /** Lip-sync включён — добавляет стоимость обработки каждой spokenLine-сцены */
  lipSyncEnabled?: boolean
  /** Lip-sync модель id (если не указана — getDefaultLipSyncModel) */
  lipSyncModelId?: string | null
  /** Список длительностей spokenLine-сцен (для точного биллинга) */
  lipSyncSceneDurations?: number[]
  /**
   * Ролик идёт маршрутом «монтаж от звука» (audio-first, spec
   * 2026-08-16-audio-first-editing-design). Добавляет в смету транскрипцию и
   * план монтажа (§7 спеки) — на старом маршруте этих шагов нет, и по
   * умолчанию (undefined/false) смета не меняется ни на цент.
   */
  audioFirst?: boolean
}

export interface CostLineItem {
  /** Этап генерации */
  stage: string
  /** Человекочитаемое название */
  label: string
  /** Количество единиц */
  units: number
  /** Единица измерения */
  unitLabel: string
  /** Цена за единицу */
  unitPrice: number
  /** Итого за этап */
  subtotal: number
  /** Название модели */
  modelName: string
}

export interface CostEstimate {
  /** Разбивка по этапам */
  breakdown: CostLineItem[]
  /** Ожидаемая (середина диапазона) стоимость */
  total: number
  /** Минимально возможная стоимость (короткий сценарий, мало сцен) */
  minTotal: number
  /** Максимально возможная стоимость (длинный сценарий, много сцен) */
  maxTotal: number
  /** Включён ли story-driven режим в расчёте */
  storyDriven: boolean
  /** Предупреждения */
  warnings: string[]
  /** Используемые модели */
  models: {
    image: { id: string; name: string } | null
    video: { id: string; name: string } | null
    music: { id: string; name: string } | null
    tts: { id: string; name: string } | null
  }
}

export interface CostPreset {
  key: string
  label: string
  description: string
  config: Partial<VideoCostConfig>
}

// ─── Расчёт стоимости ──────────────────────────────

/**
 * Рассчитывает размер изображения в мегапикселях.
 * fal.ai биллинг: Math.ceil(width * height / 1_000_000)
 */
function calcMegapixels(format: "vertical" | "horizontal", quality: "720p" | "1080p"): number {
  const sizes: Record<string, Record<string, [number, number]>> = {
    vertical: { "720p": [720, 1280], "1080p": [1080, 1920] },
    horizontal: { "720p": [1280, 720], "1080p": [1920, 1080] },
  }
  const [w, h] = sizes[format]?.[quality] ?? [1080, 1920]
  return Math.ceil((w * h) / 1_000_000)
}

/**
 * Считает стоимость одного изображения.
 */
function calcImageUnitCost(model: ModelMeta, format: "vertical" | "horizontal", quality: "720p" | "1080p"): number {
  const mp = calcMegapixels(format, quality)
  return mp * model.pricing.base
}

/**
 * Считает стоимость одного видеоклипа.
 */
function calcVideoUnitCost(model: ModelMeta, durationSec: number, withAudio: boolean): number {
  if (model.pricing.unit === "video") {
    return model.pricing.base
  }
  const pricePerSec = withAudio && model.pricing.withAudio
    ? model.pricing.withAudio
    : model.pricing.base
  return pricePerSec * durationSec
}

/**
 * Главная функция расчёта стоимости.
 *
 * Дефолты под реальный story-driven flow: AI обычно генерит ~5 сцен по ~6 сек,
 * skipImageGeneration=true (clip-only). Старые дефолты (3×5 + image gen) занижали
 * оценку в 2-3 раза по сравнению с фактом — UI показывал $1, runtime тратил $3+.
 *
 * Также возвращает min/max диапазон: AI генерит от 3 до 6 сцен с длительностью
 * 3-9s — реальный расход может варьироваться, поэтому показываем коридор.
 */
export function estimateVideoCost(config: VideoCostConfig): CostEstimate {
  const {
    imageModelId,
    videoModelId,
    format = "vertical",
    sceneCount = 5,
    clipDuration = 6,
    perSceneDurations,
    generateAudio = true,
    enableMusic = true,
    quality = "1080p",
  } = config

  // Если scenario-сценарий не подал per-scene durations — мы в planning-режиме UI.
  // Тогда story-driven считаем включённым (это сейчас дефолтный путь pipeline) с
  // skipImageGeneration=true (генерится только 1 thumbnail). Если perSceneDurations
  // пришли — мы в runtime-расчёте, режимы определяются как раньше.
  const isPlanningMode = !perSceneDurations
  const storyDrivenAssumed = isPlanningMode
  const skipImageGeneration = config.skipImageGeneration ?? storyDrivenAssumed

  const imageModel = (imageModelId ? getModel(imageModelId) : null) ?? getDefaultImageModel()
  const videoModel = (videoModelId ? getModel(videoModelId) : null) ?? getDefaultVideoModel()
  const musicModel = getModel("mubert")

  const breakdown: CostLineItem[] = []
  const warnings: string[] = []
  let total = 0

  // Story-driven mode detection
  const isStoryDriven = !!perSceneDurations && perSceneDurations.length > 0
  const effectiveSceneCount = isStoryDriven ? perSceneDurations.length : sceneCount

  // 1. Генерация промптов (Anthropic) — story-driven requires 2 AI calls
  const promptCost = isStoryDriven ? 0.02 : 0.01
  breakdown.push({
    stage: "prompts",
    label: "Генерация промптов (AI)",
    units: isStoryDriven ? 2 : 1,
    unitLabel: "вызов",
    unitPrice: isStoryDriven ? 0.01 : promptCost,
    subtotal: promptCost,
    modelName: "Claude Sonnet",
  })
  total += promptCost

  // 1b. Транскрипция и план монтажа — ТОЛЬКО на маршруте audio-first (§7 спеки
  // 2026-08-16-audio-first-editing-design): на старом маршруте этих шагов нет,
  // и без audioFirst=true блок целиком пропускается — смета старого ролика не
  // меняется.
  if (config.audioFirst) {
    // Транскрипция — единственная статья, ставка которой не литерал video-cost.ts,
    // а спека модели (REPLICATE_WHISPER, hardware_second): её тариф зависит от
    // времени GPU, а не от длины аудио, поэтому usage не нужен.
    const transcriptionSpec = findMediaSpec("replicate:whisper")
    if (transcriptionSpec) {
      const transcriptionCost = estimateMediaCost(transcriptionSpec, {})
      breakdown.push({
        stage: "transcription",
        label: "Транскрипция озвучки (Whisper)",
        units: 1,
        unitLabel: "ролик",
        unitPrice: transcriptionCost,
        subtotal: transcriptionCost,
        modelName: transcriptionSpec.name,
      })
      total += transcriptionCost
    } else {
      warnings.push("Модель транскрипции не найдена в реестре — статья не включена в смету")
    }

    // edit_plan — та же оценка одного вызова агента, что runVideoEditPlan
    // списывает как fallback (priceEditPlanModelCall, video-pipeline-steps.ts),
    // а не отдельный придуманный литерал.
    const editPlanCost = EDIT_PLAN_MODEL_CALL_ESTIMATE_USD
    breakdown.push({
      stage: "edit_plan",
      label: "План монтажа (AI)",
      units: 1,
      unitLabel: "вызов",
      unitPrice: editPlanCost,
      subtotal: editPlanCost,
      modelName: "Claude (edit_plan)",
    })
    total += editPlanCost
  }

  // 2. Генерация изображений
  // skipImageGeneration теперь всегда генерит 1 thumbnail (preview для UI).
  if (skipImageGeneration) {
    const thumbnailCost = calcImageUnitCost(imageModel, format, quality)
    breakdown.push({
      stage: "images",
      label: "Preview thumbnail (1 изобр., clip-only mode)",
      units: 1,
      unitLabel: "изобр.",
      unitPrice: thumbnailCost,
      subtotal: thumbnailCost,
      modelName: imageModel.name,
    })
    total += thumbnailCost
  } else {
    const imageUnitCost = calcImageUnitCost(imageModel, format, quality)
    const imageTotal = imageUnitCost * effectiveSceneCount
    breakdown.push({
      stage: "images",
      label: "Генерация изображений",
      units: effectiveSceneCount,
      unitLabel: "изобр.",
      unitPrice: imageUnitCost,
      subtotal: imageTotal,
      modelName: imageModel.name,
    })
    total += imageTotal
  }

  // 3. Генерация видеоклипов — per-scene durations if story-driven
  let videoTotal = 0
  if (isStoryDriven) {
    // Per-scene cost: each scene may have different duration
    for (const dur of perSceneDurations) {
      videoTotal += calcVideoUnitCost(videoModel, dur, generateAudio)
    }
    const avgDuration = perSceneDurations.reduce((s, d) => s + d, 0) / perSceneDurations.length
    breakdown.push({
      stage: "clips",
      label: `Генерация видеоклипов (per-scene: ${perSceneDurations.map(d => `${d}s`).join(', ')})`,
      units: effectiveSceneCount,
      unitLabel: "клип",
      unitPrice: calcVideoUnitCost(videoModel, avgDuration, generateAudio),
      subtotal: videoTotal,
      modelName: videoModel.name,
    })
  } else {
    const videoUnitCost = calcVideoUnitCost(videoModel, clipDuration, generateAudio)
    videoTotal = videoUnitCost * sceneCount
    breakdown.push({
      stage: "clips",
      label: "Генерация видеоклипов",
      units: sceneCount,
      unitLabel: "клип",
      unitPrice: videoUnitCost,
      subtotal: videoTotal,
      modelName: videoModel.name,
    })
  }
  total += videoTotal

  if (videoTotal > 2.0) {
    warnings.push(`Видеоклипы стоят $${videoTotal.toFixed(2)} — это основная статья расходов`)
  }

  if (skipImageGeneration) {
    warnings.push("Image generation пропущена (story-driven clip-only mode) — экономия на изображениях")
  }

  // 4. Музыка (Mubert)
  if (enableMusic && musicModel) {
    const musicCost = musicModel.pricing.base
    breakdown.push({
      stage: "music",
      label: "Фоновая музыка",
      units: 1,
      unitLabel: "трек",
      unitPrice: musicCost,
      subtotal: musicCost,
      modelName: musicModel.name,
    })
    total += musicCost
  }

  // 4b. Voiceover (TTS) — если включён
  let ttsModel: ModelMeta | null = null
  if (config.voiceoverEnabled) {
    const preferred = config.voiceoverModelId ? getModel(config.voiceoverModelId) : null
    ttsModel = preferred ?? getDefaultTtsModel()
    if (ttsModel) {
      // Estimate characters: либо из переданных voiceoverLines, либо ~80 chars на сцену как эвристика
      const totalChars = config.voiceoverLines?.reduce((s, n) => s + n, 0)
        ?? effectiveSceneCount * 80
      let ttsCost = 0
      let unitLabel = "символ"
      let units = totalChars

      if (ttsModel.pricing.unit === "character") {
        ttsCost = totalChars * ttsModel.pricing.base
      } else if (ttsModel.pricing.unit === "audio_second") {
        // Эвристика: 2.8 words/sec, ~5 chars/word → ~14 chars/sec
        const estAudioSec = totalChars / 14
        ttsCost = estAudioSec * ttsModel.pricing.base
        unitLabel = "сек аудио"
        units = Math.round(estAudioSec * 10) / 10
      }

      breakdown.push({
        stage: "voiceover",
        label: `Voiceover (TTS): ${effectiveSceneCount} сцен`,
        units,
        unitLabel,
        unitPrice: ttsModel.pricing.base,
        subtotal: ttsCost,
        modelName: ttsModel.name,
      })
      total += ttsCost

      if (ttsCost > 0.5) {
        warnings.push(`Voiceover стоит $${ttsCost.toFixed(2)} — рассмотрите budget TTS модель (Kokoro) для экономии`)
      }
    } else {
      warnings.push("Voiceover включён, но нет интегрированной TTS модели — озвучка будет пропущена")
    }
  }

  // 4c. Lip-sync — обработка готовых клипов через Kling (Replicate) или fal fallback
  let lipSyncModel: ModelMeta | null = null
  if (config.lipSyncEnabled) {
    const preferredLs = config.lipSyncModelId ? getModel(config.lipSyncModelId) : null
    lipSyncModel = (preferredLs && preferredLs.task === 'lip_sync')
      ? preferredLs
      : getDefaultLipSyncModel()
    if (lipSyncModel) {
      // Считаем длительность только сцен с spokenLine. Если конкретные длительности
      // не переданы — heuristically берём половину сцен по средней длительности.
      const fallbackSec = perSceneDurations?.[0] ?? clipDuration ?? 5
      const lipSyncSeconds = config.lipSyncSceneDurations?.length
        ? config.lipSyncSceneDurations.reduce((s, n) => s + n, 0)
        : Math.ceil(effectiveSceneCount / 2) * fallbackSec
      const lipSyncCost = lipSyncSeconds * lipSyncModel.pricing.base
      breakdown.push({
        stage: "lip_sync",
        label: `Lip-sync: ${config.lipSyncSceneDurations?.length ?? Math.ceil(effectiveSceneCount / 2)} сцен`,
        units: lipSyncSeconds,
        unitLabel: "сек",
        unitPrice: lipSyncModel.pricing.base,
        subtotal: lipSyncCost,
        modelName: lipSyncModel.name,
      })
      total += lipSyncCost
    } else {
      warnings.push("Lip-sync включён, но нет интегрированной lip-sync модели — синхронизация будет пропущена")
    }
  }

  // 5. Сборка (бесплатно, локальный FFmpeg)
  breakdown.push({
    stage: "assembly",
    label: "Сборка видео (FFmpeg)",
    units: 1,
    unitLabel: "операция",
    unitPrice: 0,
    subtotal: 0,
    modelName: "Локальный",
  })

  // Предупреждения
  if (sceneCount > 5) {
    warnings.push(`${sceneCount} сцен — генерация может занять более 30 минут`)
  }
  if (clipDuration >= 10 && sceneCount >= 5) {
    warnings.push("Длинные клипы + много сцен = высокая стоимость и время генерации")
  }
  if (generateAudio && videoModel.pricing.withAudio) {
    const audioSurcharge = ((videoModel.pricing.withAudio - videoModel.pricing.base) / videoModel.pricing.base * 100).toFixed(0)
    warnings.push(`Встроенное аудио (${videoModel.name}) добавляет +${audioSurcharge}% к стоимости видеоклипов`)
  }

  // Расчёт диапазона: AI генерит от 3 до 6 сцен, длительностью 3-9с каждая.
  // В runtime у нас фиксированные perSceneDurations — диапазон сжимается до
  // одной точки.
  let minTotal = total
  let maxTotal = total
  if (isPlanningMode) {
    // Стоимость клипа по времени: считаем для min (3 сцены × 3с) и max (6 × 9с).
    const baseNonClipCost = total - videoTotal
    const minClipCost = calcVideoUnitCost(videoModel, 3, generateAudio) * 3
    const maxClipCost = calcVideoUnitCost(videoModel, 9, generateAudio) * 6
    minTotal = baseNonClipCost + minClipCost
    maxTotal = baseNonClipCost + maxClipCost
    if (maxTotal - minTotal > 1) {
      warnings.push(`AI планирует 3-6 сцен длительностью 3-9с — реальная стоимость в диапазоне $${minTotal.toFixed(2)} — $${maxTotal.toFixed(2)}`)
    }
  }

  return {
    breakdown,
    total,
    minTotal,
    maxTotal,
    storyDriven: storyDrivenAssumed,
    warnings,
    models: {
      image: { id: imageModel.id, name: imageModel.name },
      video: { id: videoModel.id, name: videoModel.name },
      music: enableMusic && musicModel
        ? { id: musicModel.id, name: musicModel.name }
        : null,
      tts: config.voiceoverEnabled && ttsModel
        ? { id: ttsModel.id, name: ttsModel.name }
        : null,
    },
  }
}

// ─── Пресеты оптимизации стоимости ─────────────────

/**
 * Модель кадра для пресета берётся из рекомендации по той же стратегии, что
 * применяет пайплайн, а не литералом. Иначе кнопка «Сбалансированный» проставляла
 * бы в конфиг модель, которой в маршруте способности уже нет, и смета в UI
 * расходилась бы с фактом с первого дня (спека медиаконтура §3.6).
 */
const PRESET_IMAGE_MODELS = {
  budget: recommendModels("budget").imageModel.id,
  balanced: recommendModels("balanced").imageModel.id,
  quality: recommendModels("high_realism").imageModel.id,
} as const

export const COST_PRESETS: CostPreset[] = [
  {
    key: "budget",
    label: "Минимальный бюджет",
    description: "Самые дешёвые настройки. Быстрая генерация, базовое качество.",
    config: {
      imageModelId: PRESET_IMAGE_MODELS.budget,
      sceneCount: 3,
      clipDuration: 3,
      generateAudio: false,
      enableMusic: false,
      voiceoverEnabled: false,
      quality: "720p",
    },
  },
  {
    key: "balanced",
    label: "Сбалансированный",
    description: "Хорошее соотношение цены и качества для большинства задач.",
    config: {
      imageModelId: PRESET_IMAGE_MODELS.balanced,
      sceneCount: 3,
      clipDuration: 5,
      generateAudio: true,
      enableMusic: true,
      voiceoverEnabled: true,
      quality: "1080p",
    },
  },
  {
    key: "quality",
    label: "Максимальное качество",
    description: "Лучшее качество, дольше и дороже. Включает AI lip-sync для сцен с диалогом.",
    config: {
      imageModelId: PRESET_IMAGE_MODELS.quality,
      sceneCount: 5,
      clipDuration: 10,
      generateAudio: true,
      enableMusic: true,
      voiceoverEnabled: true,
      lipSyncEnabled: true,
      quality: "1080p",
    },
  },
]

/**
 * Рекомендации по снижению стоимости.
 * Возвращает список конкретных действий с ожидаемой экономией.
 */
export function getCostOptimizationTips(config: VideoCostConfig): Array<{
  tip: string
  action: string
  field: string
  newValue: unknown
  savingsPercent: number
}> {
  const current = estimateVideoCost(config)
  const tips: Array<{
    tip: string
    action: string
    field: string
    newValue: unknown
    savingsPercent: number
  }> = []

  // Предложить дешёвую image model — ту же, что и бюджетный пресет.
  // Имя модели в тексте подсказки берём из витрины: захардкоженное «FLUX
  // Schnell» соврало бы, как только бюджетной станет другая модель.
  if (config.imageModelId !== PRESET_IMAGE_MODELS.budget) {
    const cheaper = estimateVideoCost({ ...config, imageModelId: PRESET_IMAGE_MODELS.budget })
    const savings = ((current.total - cheaper.total) / current.total) * 100
    if (savings > 1) {
      const cheapName = getModel(PRESET_IMAGE_MODELS.budget)?.name ?? PRESET_IMAGE_MODELS.budget
      tips.push({
        tip: `Использовать ${cheapName} для изображений`,
        action: "Заметно дешевле, чуть ниже детализация",
        field: "imageModelId",
        newValue: PRESET_IMAGE_MODELS.budget,
        savingsPercent: Math.round(savings),
      })
    }
  }

  // Предложить уменьшить количество сцен
  if ((config.sceneCount ?? 3) > 3) {
    const fewer = estimateVideoCost({ ...config, sceneCount: 3 })
    const savings = ((current.total - fewer.total) / current.total) * 100
    tips.push({
      tip: "Уменьшить количество сцен до 3",
      action: "Меньше изображений и клипов = дешевле",
      field: "sceneCount",
      newValue: 3,
      savingsPercent: Math.round(savings),
    })
  }

  // Предложить отключить аудио в видео. Tip актуален только для моделей с
  // pricing.withAudio (Kling); для Wan/Hailuo savings всё равно будет 0.
  if (config.generateAudio !== false) {
    const noAudio = estimateVideoCost({ ...config, generateAudio: false })
    const savings = ((current.total - noAudio.total) / current.total) * 100
    if (savings > 1) {
      const audioModelName = current.models.video?.name ?? "выбранной модели"
      tips.push({
        tip: "Отключить встроенное аудио в видеоклипах",
        action: `Убирает надбавку за нативное аудио в ${audioModelName}`,
        field: "generateAudio",
        newValue: false,
        savingsPercent: Math.round(savings),
      })
    }
  }

  // Предложить сократить длительность
  if ((config.clipDuration ?? 5) > 5) {
    const shorter = estimateVideoCost({ ...config, clipDuration: 5 })
    const savings = ((current.total - shorter.total) / current.total) * 100
    tips.push({
      tip: "Сократить длительность клипов до 5 сек",
      action: "Быстрее генерация, меньше стоимость",
      field: "clipDuration",
      newValue: 5,
      savingsPercent: Math.round(savings),
    })
  }

  // Предложить отключить музыку
  if (config.enableMusic !== false) {
    const noMusic = estimateVideoCost({ ...config, enableMusic: false })
    const savings = ((current.total - noMusic.total) / current.total) * 100
    if (savings > 0.5) {
      tips.push({
        tip: "Отключить фоновую музыку",
        action: "Экономия на Mubert",
        field: "enableMusic",
        newValue: false,
        savingsPercent: Math.round(savings),
      })
    }
  }

  // Предложить 720p
  if (config.quality !== "720p") {
    const lower = estimateVideoCost({ ...config, quality: "720p" })
    const savings = ((current.total - lower.total) / current.total) * 100
    if (savings > 1) {
      tips.push({
        tip: "Понизить качество до 720p",
        action: "Меньше мегапикселей = дешевле изображения",
        field: "quality",
        newValue: "720p",
        savingsPercent: Math.round(savings),
      })
    }
  }

  return tips.sort((a, b) => b.savingsPercent - a.savingsPercent)
}
