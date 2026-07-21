/**
 * Типы для reference-driven content generation.
 * ReferenceBreakdown — структурированный анализ медиа-референса,
 * хранится в IdeaAnalysis.referenceBreakdown (Json).
 */

// --- Транскрипт ---

export interface TranscriptSegment {
  /** Начало в секундах */
  start: number
  /** Длительность в секундах */
  duration: number
  /** Текст сегмента */
  text: string
}

export interface TranscriptData {
  /** Полный текст транскрипта */
  fullText: string
  /** Сегменты с таймкодами (если доступны) */
  segments: TranscriptSegment[]
  /** Источник транскрипта */
  source: 'youtube_captions' | 'page_extraction' | 'manual' | 'unavailable' | 'whisper' | 'platform_captions'
  /** Язык транскрипта */
  language: string | null
}

// --- Reference analysis progress (для UI polling) ---

export type ReferenceProgressStage =
  | 'queued'
  | 'downloading'
  | 'extracting_frames'
  | 'transcribing'
  | 'analyzing_frames'
  | 'synthesizing'

export interface ReferenceProgress {
  stage: ReferenceProgressStage
  /** Для analyzing_frames: текущий и общий счётчики */
  framesDone?: number
  framesTotal?: number
  /** Прошедшее время в секундах с момента старта */
  elapsedSec?: number
  /** ISO timestamp старта */
  startedAt?: string
}

// --- Scene Timeline ---

export interface ReferenceScene {
  /** Номер сцены */
  order: number
  /** Начало (секунды или описание) */
  startMarker: string
  /** Длительность */
  duration: string
  /** Что происходит */
  action: string
  /** Цель сцены в нарративе */
  purpose: string
  /** Текст на экране / субтитры в этой сцене */
  onScreenText: string | null
  /** Визуальные характеристики */
  visualCues: string
  /** Эмоциональный тон */
  emotionalTone: string
  /** Камера / ракурс */
  cameraWork: string | null
}

// --- Narrative Mechanics ---

export interface NarrativeMechanics {
  /** Тип хука */
  hookType: string
  /** Описание хука — что именно цепляет */
  hookDescription: string
  /** Механика body — как удерживается внимание */
  bodyMechanic: string
  /** CTA / концовка */
  ctaMechanic: string
  /** Эмоциональная дуга */
  emotionalArc: string[]
  /** Ритм / pacing */
  pacing: string
  /** Narrative arc template */
  narrativeTemplate: string
  /** Transformation arc (если есть) */
  transformationArc: string | null
}

// --- Visual Patterns ---

export interface VisualPatterns {
  /** Доминантная палитра */
  colorPalette: string[]
  /** Стиль освещения */
  lighting: string
  /** Работа камеры */
  cameraStyle: string
  /** Композиция кадра */
  composition: string
  /** Текстовые оверлеи (стиль, позиция) */
  textOverlayStyle: string | null
  /** Общая эстетика */
  aesthetic: string
  /** Визуальные эффекты */
  effects: string[]
}

// --- Subtitle Mechanics ---

export interface SubtitleMechanics {
  /** Есть ли субтитры */
  hasSubtitles: boolean
  /** Стиль субтитров */
  style: string | null
  /** Позиция субтитров */
  placement: string | null
  /** Ритм появления */
  rhythm: string | null
  /** Размер текста */
  textSize: string | null
  /** Цвет / контраст */
  colorScheme: string | null
}

// --- App Integration Pattern ---

export interface AppIntegrationPattern {
  /** Как продукт/приложение интегрировано */
  integrationType: string
  /** В какой момент появляется */
  timing: string
  /** Насколько органично */
  organicScore: number
  /** Описание паттерна */
  description: string
}

// --- Abstracted Creative Pattern ---

export interface AbstractedPattern {
  /** Название паттерна */
  name: string
  /** Категория: hook | narrative | visual | pacing | subtitle | integration */
  category: string
  /** Абстрактное описание (без копирования оригинала) */
  abstractDescription: string
  /** Как применить к новому контенту */
  applicationGuide: string
  /** Сила паттерна 1-100 */
  strength: number
}

// --- Originality Guide ---

export interface OriginalityGuide {
  /** Что безопасно переиспользовать */
  safeToReuse: string[]
  /** Что нельзя копировать */
  mustTransform: string[]
  /** Элементы, которые должны быть оригинальными */
  requireOriginal: string[]
  /** Рекомендации по трансформации */
  transformationSuggestions: string[]
  /** Оценка оригинальности (0-1, где 1 = максимально оригинально) */
  targetOriginalityScore: number
}

// --- Full Reference Breakdown ---

export interface ReferenceBreakdown {
  /** Версия формата */
  version: string
  /** Тип медиа */
  mediaType: 'video' | 'image' | 'unknown'
  /** Транскрипт (для видео) */
  transcript: TranscriptData | null
  /** Разбивка на сцены */
  sceneTimeline: ReferenceScene[]
  /** Нарративные механики */
  narrativeMechanics: NarrativeMechanics
  /** Визуальные паттерны */
  visualPatterns: VisualPatterns
  /** Механики субтитров */
  subtitleMechanics: SubtitleMechanics
  /** Паттерн интеграции приложения */
  appIntegrationPattern: AppIntegrationPattern | null
  /** Абстрагированные креативные паттерны (safe-to-reuse) */
  abstractedPatterns: AbstractedPattern[]
  /** Гайд по оригинальности / anti-copy */
  originalityGuide: OriginalityGuide
  /** Общая оценка уверенности анализа 0-1 */
  confidence: number
  /** Что доступно / что недоступно */
  dataAvailability: {
    hasTranscript: boolean
    hasTimedSegments: boolean
    hasThumbnail: boolean
    hasDescription: boolean
    metadataRichness: 'rich' | 'moderate' | 'sparse'
  }
}

// --- Reference Brief (output of originality transformer, input for scenario pipeline) ---

export interface ReferenceBrief {
  /** Абстрагированный hook-паттерн */
  hookPattern: string
  /** Абстрагированная нарративная структура */
  narrativeStructure: string
  /** Абстрагированные визуальные принципы */
  visualPrinciples: string
  /** Ритм и pacing */
  pacingGuide: string
  /** Стиль субтитров */
  subtitleStyleGuide: string
  /** Паттерн интеграции приложения */
  appIntegrationGuide: string | null
  /** Трансформационные ограничения */
  originalityConstraints: string[]
  /** Общий creative direction */
  creativeDirection: string
  /** Оценка уверенности */
  confidence: number
}
