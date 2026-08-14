/**
 * Story-driven scenario types.
 * Structured output for story architect, scene planner, continuity director.
 */

import type { DeviceType } from '~~/shared/utils/video-prompt-helpers'

// --- Story Arc ---

export type StoryArcTemplate =
  | 'transformation'    // слабый -> сильный через приложение
  | 'discovery'         // не знал -> нашёл -> результат
  | 'challenge'         // проблема -> попытка -> приложение спасает
  | 'comparison'        // было/стало
  | 'day_in_life'       // один день с приложением
  | 'social_proof'      // другие уже используют -> и ты
  | 'curiosity'         // загадка -> раскрытие -> wow
  | 'custom'            // свободная драматургия

export interface ProtagonistProfile {
  type: 'person' | 'object' | 'abstract'
  description: string
  initialState: string
  finalState: string
  visualIdentifiers: string[]  // что визуально отличает героя на протяжении ролика
}

export interface StoryArc {
  template: StoryArcTemplate
  premise: string                // исходная ситуация (1-2 предложения)
  conflict: string               // дефицит / сомнение / проблема
  turningPoint: string           // момент встречи с приложением
  resolution: string             // трансформация / результат
  emotionalJourney: string[]     // эмоции по сценам: ["frustration", "curiosity", "excitement", "satisfaction"]
}

// --- Scene Cards ---

/**
 * Привязка сцены к скриншоту приложения. Если задано — клип сцены генерируется
 * через Kling image-to-video, а fileUrl используется как опорное изображение.
 */
export type AppScreenRefIntent =
  | 'show_interface'         // экран приложения главный фокус кадра
  | 'reaction_to_interface'  // герой реагирует на UI, экран в кадре частично
  | 'background_glance'      // экран мельком на фоне, не главный сюжет

export interface AppScreenRef {
  imageId: string             // AppReferenceImage.id
  fileUrl: string             // снапшот URL — чтобы при удалении исходника сцена не падала
  intent: AppScreenRefIntent
}

/**
 * Откуда взят опорный кадр сцены. Кадр приложения — лишь один из источников:
 * тем же маршрутом image-to-video оживляются портрет ведущего (AI-аватар) и
 * референс сцены. Значения совпадают с `ReferenceFrameSource` на сервере.
 */
export type SceneReferenceFrameSource = 'app_screen' | 'character' | 'scene'

export interface SceneReferenceFrameRef {
  source: SceneReferenceFrameSource
  /** id записи в таблице источника: AppReferenceImage | CharacterReferenceImage | SceneReferenceImage. */
  imageId: string
}

export interface SceneCard {
  order: number
  purpose: string                // зачем эта сцена нужна в драматургии
  setting: string                // место действия
  action: string                 // что происходит
  whatChanges: string            // что меняется в этой сцене
  emotionalState: string         // эмоция героя/зрителя
  appIntegrationBeat: string | null  // как приложение появляется в сцене (null если не появляется)
  visualPromptGuidance: string   // guidance для генерации визуала (для FLUX/Runway)
  /**
   * Опорный кадр сцены для image-to-video. Общий источник: кадр приложения,
   * портрет ведущего, референс сцены. Задан — сцена снимается оживлением этого
   * кадра, а не text-to-video.
   */
  referenceFrame?: SceneReferenceFrameRef | null
  /**
   * Устаревший алиас `referenceFrame` с источником `app_screen`. Остаётся ради
   * снапшотов уже запущенных роликов и промпта сценариста; при наличии обоих
   * полей выигрывает `referenceFrame`.
   */
  appScreenRef?: AppScreenRef | null
  subtitleCopy: string           // текст субтитров для сцены
  subtitlePlacement: SubtitlePlacement
  voiceoverLine: string | null   // строка off-screen narrator TTS (отдельный аудио-трек через tts.ts)
  /**
   * Прямая речь персонажа в кадре — уходит в kling-video prompt для lip-sync
   * через generate_audio=true. Отличается от voiceoverLine (narrator off-screen)
   * и от subtitleCopy (экранный текст). Null если в сцене нет говорящего персонажа
   * или в кадре только действие без диалога.
   * Пример: subtitleCopy="Try Vitafy", spokenLine="Honestly I didn't believe it either" —
   * персонаж рассказывает жизненную историю, а субтитры продают приложение.
   */
  spokenLine: string | null
  continuityNotes: string        // заметки для continuity director
  duration: string               // "3s", "5s"
  cameraAngle: string            // POV, flat lay, close-up, etc.
  props: string[]                // реквизит
  /**
   * Устройства, реально присутствующие в кадре. Заполняется scene-planner'ом
   * когда в action/setting упомянут телефон/планшет/ноутбук/монитор/тв/часы.
   * Триггерит инжект DEVICE ORIENTATION RULES (positive) и DEVICE_NEGATIVES
   * (negative) downstream — защита от бага "экран на задней крышке".
   */
  devicesInScene?: DeviceType[]
  /**
   * Какие FavoritePrompt-эталоны и в каких аспектах повлияли на эту сцену.
   * Заполняется scene-planner'ом когда AI применил паттерн из REFERENCE PATTERNS.
   * Опциональное поле — старые storyPlan'ы без него остаются совместимыми.
   */
  appliedReferences?: AppliedReference[]
}

/**
 * Трассировка применённого паттерна из FavoritePrompt.
 * favoritePromptId — ID FavoritePrompt из библиотеки (валидируется на этапе
 * scene-planner-validate против списка реально загруженных id).
 * aspects — какие именно аспекты паттерна повлияли на сцену.
 */
export interface AppliedReference {
  favoritePromptId: number
  aspects: Array<'camera' | 'lighting' | 'actionStructure' | 'mood' | 'pacing' | 'composition'>
}

export type SubtitlePosition = 'top' | 'center' | 'bottom'
export type SubtitleAlignment = 'left' | 'center' | 'right'

export interface SubtitlePlacement {
  position: SubtitlePosition
  alignment: SubtitleAlignment
  avoidZones: string[]           // ["face", "app_ui", "product"]
}

// --- Subtitle Style Profile ---

/** Допустимые границы wordsPerLine. Источник истины — все 5 мест синхронизированы. */
export const SUBTITLE_WORDS_PER_LINE_MIN = 3
export const SUBTITLE_WORDS_PER_LINE_MAX = 6
export const SUBTITLE_WORDS_PER_LINE_DEFAULT = 4

export interface SubtitleStyleProfile {
  typography: {
    fontIntent: string           // "bold sans-serif", "handwritten", etc.
    casing: 'uppercase' | 'lowercase' | 'sentence' | 'mixed'
    maxLineLength: number        // символов (legacy fallback, используется если wordsPerLine не задан)
    /** Стандарт TikTok/Reels — 4 слова на строку, стабильнее char-based переноса. Bounds 3..6, default 4. */
    wordsPerLine: number
    maxLines: number             // строк одновременно
  }
  visual: {
    primaryColor: string         // hex
    outlineColor: string | null  // hex
    shadowEnabled: boolean
    backgroundColor: string | null  // hex с opacity hint
  }
  animation: {
    entrance: 'fade' | 'slide_up' | 'typewriter' | 'pop' | 'none'
    exit: 'fade' | 'slide_down' | 'none'
    emphasis: 'highlight' | 'scale' | 'color_shift' | 'none'
  }
  consistency: {
    maintainStyleAcrossScenes: boolean
    sceneOverrideAllowed: boolean
  }
}

// --- Voiceover Plan ---

export interface VoiceoverPlan {
  enabled: boolean
  narratorPersona: string | null      // "спокойный мужской голос 30 лет", "энергичная женщина"
  pacing: 'slow' | 'moderate' | 'fast'
  emotionalContour: string[]          // ["neutral", "intrigued", "excited", "warm"]
  lines: VoiceoverLine[]
  syncGuidance: string                // общие заметки по синхронизации
}

export interface VoiceoverLine {
  sceneOrder: number
  text: string
  emotion: string
  pauseAfter: 'none' | 'short' | 'long'
}

// --- Continuity Bible ---

export interface ContinuityBible {
  protagonist: ProtagonistProfile
  visualCode: {
    colorPalette: string[]       // hex
    lightingConsistency: string
    environmentStyle: string
  }
  antiLoopRules: string[]        // правила против повторяющихся клипов
  sceneTransitions: string[]     // допустимые переходы
  forbiddenElements: string[]    // что запрещено визуально/сюжетно
}

// --- Full Story Plan (хранится как JSON в ScenarioVariant.storyPlan) ---

export interface StoryPlan {
  version: string
  storyArc: StoryArc
  protagonist: ProtagonistProfile
  scenes: SceneCard[]
  continuityBible: ContinuityBible
  subtitleStyle: SubtitleStyleProfile
  voiceoverPlan: VoiceoverPlan
  globalVisualSystem: {
    stylePrompt: string          // master prompt для генерации
    colorPalette: string[]
    mood: string
    lighting: string
  }
  appIntegrationStrategy: string   // как приложение встроено в повествование
  negativeConstraints: string[]    // avoid list
  fullScript: string               // полный скрипт для озвучки
}

// --- Generation Profile / Preset ---

export interface ScenarioGenerationProfileData {
  storytellingMode: StoryArcTemplate | 'auto'
  protagonistMode: 'person' | 'object' | 'abstract' | 'auto'
  continuityStrictness: 'strict' | 'moderate' | 'relaxed'
  sceneDiversity: 'high' | 'medium' | 'low'
  /** Бюджетный лимит: minimal (3×3с ≈ \$1) / auto / detailed / cinematic (6×9с ≈ \$5) */
  sceneCountStrategy?: 'auto' | 'minimal' | 'detailed' | 'cinematic'
  transformationArcTemplate: string | null  // описание дуги трансформации
  appIntegrationStyle: 'native' | 'prominent' | 'subtle'
  pacing: 'slow' | 'moderate' | 'fast'
  visualPaletteCues: string[]       // подсказки по палитре
  subtitleStrategy: 'dynamic' | 'static' | 'minimal' | 'none'
  voiceoverStrategy: 'full' | 'partial' | 'none'
  variationRules: string[]          // правила для вариативности
  negativeRules: string[]           // что исключить
}

// --- Optimization Memory ---

export interface OptimizationRequirement {
  type: 'requirement' | 'recommendation' | 'anti_pattern'
  category: 'hook' | 'story' | 'visual' | 'subtitle' | 'pacing' | 'app_integration' | 'general'
  text: string
  source: 'analytics' | 'human_feedback' | 'reference' | 'review_action'
  sourceId: number | null          // ID записи-источника
  weight: number                   // 0-100, приоритет
  createdAt: string
}

export interface OptimizationMemoryData {
  requirements: OptimizationRequirement[]
  recommendations: OptimizationRequirement[]
  antiPatterns: OptimizationRequirement[]
  lastUpdated: string
}

// --- Scenario Feedback ---

export type FeedbackSentiment = 'positive' | 'negative' | 'neutral' | 'mixed'

export interface ScenarioFeedbackDerived {
  requirements: string[]
  recommendations: string[]
  antiPatterns: string[]
  sentiment: FeedbackSentiment
  keyThemes: string[]
}
