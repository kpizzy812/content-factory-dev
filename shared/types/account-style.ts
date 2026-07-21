/**
 * Account Style Profile — creative identity на уровне аккаунта.
 * Определяет визуальный язык, tone of voice, subtitle conventions,
 * protagonist стиль, CTA поведение и ограничения для всего контента аккаунта.
 */

// --- Style Profile Sections ---

export interface AccountToneProfile {
  /** Основной tone of voice: "дружелюбный и энергичный", "экспертный и спокойный" */
  voice: string
  /** Персона нарратора: "молодой парень 25 лет", "женщина-эксперт" */
  narratorPersona: string | null
  /** Формальность: casual → formal */
  formality: 'casual' | 'neutral' | 'formal'
  /** Эмоциональный диапазон */
  emotionalRange: string[]
  /** Запрещённые речевые паттерны */
  forbiddenPhrases: string[]
}

export interface AccountVisualLanguage {
  /** Основная палитра (3-6 hex) */
  colorPalette: string[]
  /** Настроение / эстетика: "warm minimalist", "neon cyberpunk" */
  aesthetic: string
  /** Стиль освещения */
  lighting: string
  /** Предпочтительный стиль камеры */
  cameraStyle: string
  /** Визуальные эффекты, которые допустимы */
  allowedEffects: string[]
  /** Визуальные паттерны, которых избегать */
  forbiddenVisuals: string[]
}

export interface AccountSubtitleStyle {
  /** Стиль шрифта: "bold sans-serif", "handwritten" */
  fontIntent: string
  /** Регистр */
  casing: 'uppercase' | 'lowercase' | 'sentence' | 'mixed'
  /** Основной цвет субтитров (hex) */
  primaryColor: string
  /** Цвет обводки (hex или null) */
  outlineColor: string | null
  /** Анимация появления */
  entrance: 'fade' | 'slide_up' | 'typewriter' | 'pop' | 'none'
  /** Позиция по умолчанию */
  defaultPosition: 'top' | 'center' | 'bottom'
}

export interface AccountProtagonistConventions {
  /** Предпочтительный тип героя */
  preferredType: 'person' | 'object' | 'abstract' | 'any'
  /** Описание визуального стиля героя */
  visualStyle: string
  /** Повторяющиеся визуальные маркеры (аксессуары, цвета одежды) */
  recurringMarkers: string[]
  /** Ограничения (что герой НЕ может быть/делать) */
  restrictions: string[]
}

export interface AccountCtaBehavior {
  /** Стиль CTA */
  style: 'soft' | 'direct' | 'question' | 'challenge'
  /** Примеры хороших CTA для этого аккаунта */
  examples: string[]
  /** Запрещённые CTA паттерны */
  forbidden: string[]
}

export interface AccountEditingRhythm {
  /** Темп: slow / moderate / fast */
  pacing: 'slow' | 'moderate' | 'fast'
  /** Предпочтительная длительность видео в секундах */
  preferredDuration: number
  /** Стиль переходов */
  transitionStyle: string
  /** Предпочтительное количество сцен */
  preferredSceneCount: number
}

export interface AccountPreviewStyle {
  /** Стиль превью/thumbnail */
  thumbnailApproach: string
  /** Обязательные элементы на превью */
  requiredElements: string[]
  /** Стиль текста на превью */
  textStyle: string | null
}

// --- Full Style Profile Data (stored as JSON) ---

export interface AccountStyleProfileData {
  /** Tone of voice и персона */
  tone: AccountToneProfile
  /** Визуальный язык */
  visual: AccountVisualLanguage
  /** Стиль субтитров */
  subtitles: AccountSubtitleStyle
  /** Конвенции героя/персонажа */
  protagonist: AccountProtagonistConventions
  /** CTA поведение */
  cta: AccountCtaBehavior
  /** Ритм монтажа */
  editing: AccountEditingRhythm
  /** Стиль превью */
  preview: AccountPreviewStyle
  /** Степень допустимого эксперимента (0-100) */
  experimentationDegree: number
  /** Строгость соблюдения стиля (0-100) */
  consistencyStrictness: number
  /** Источники стиля (URL или описание) */
  referenceSources: string[]
}

// --- Group Style Policy ---

export type GroupStyleMode = 'independent' | 'unified' | 'base_with_overrides'

export interface GroupStylePolicy {
  /** Режим стиля группы */
  mode: GroupStyleMode
  /** Базовый стиль группы (для unified и base_with_overrides) */
  baseStyle: Partial<AccountStyleProfileData> | null
  /** Какие секции можно переопределять в аккаунте (для base_with_overrides) */
  overridableSections: Array<keyof AccountStyleProfileData>
}

// --- API / UI types ---

export type StyleProfileStatus = 'not_set' | 'partial' | 'complete'

export interface AccountStyleProfileSummary {
  id: number
  socialAccountId: number
  version: number
  status: StyleProfileStatus
  lastUpdatedAt: string
  createdAt: string
}

export interface AccountStyleProfileFull extends AccountStyleProfileSummary {
  data: AccountStyleProfileData
}

export interface AccountStyleRevisionEntry {
  id: number
  profileId: number
  version: number
  changeType: 'manual' | 'ai_suggestion' | 'analytics_derived'
  changeSummary: string
  changedSections: string[]
  previousData: Partial<AccountStyleProfileData>
  newData: Partial<AccountStyleProfileData>
  accepted: boolean
  appliedById: number | null
  createdAt: string
}

export interface StyleRecommendation {
  section: keyof AccountStyleProfileData
  field: string
  currentValue: unknown
  suggestedValue: unknown
  reason: string
  confidence: number
  source: 'analytics' | 'reference' | 'feedback'
}

// --- Defaults ---

export const defaultAccountToneProfile: AccountToneProfile = {
  voice: '',
  narratorPersona: null,
  formality: 'casual',
  emotionalRange: [],
  forbiddenPhrases: [],
}

export const defaultAccountVisualLanguage: AccountVisualLanguage = {
  colorPalette: [],
  aesthetic: '',
  lighting: '',
  cameraStyle: '',
  allowedEffects: [],
  forbiddenVisuals: [],
}

export const defaultAccountSubtitleStyle: AccountSubtitleStyle = {
  fontIntent: 'bold sans-serif',
  casing: 'sentence',
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  entrance: 'fade',
  defaultPosition: 'bottom',
}

export const defaultAccountProtagonistConventions: AccountProtagonistConventions = {
  preferredType: 'any',
  visualStyle: '',
  recurringMarkers: [],
  restrictions: [],
}

export const defaultAccountCtaBehavior: AccountCtaBehavior = {
  style: 'soft',
  examples: [],
  forbidden: [],
}

export const defaultAccountEditingRhythm: AccountEditingRhythm = {
  pacing: 'moderate',
  preferredDuration: 30,
  transitionStyle: '',
  preferredSceneCount: 4,
}

export const defaultAccountPreviewStyle: AccountPreviewStyle = {
  thumbnailApproach: '',
  requiredElements: [],
  textStyle: null,
}

export const defaultAccountStyleProfileData: AccountStyleProfileData = {
  tone: defaultAccountToneProfile,
  visual: defaultAccountVisualLanguage,
  subtitles: defaultAccountSubtitleStyle,
  protagonist: defaultAccountProtagonistConventions,
  cta: defaultAccountCtaBehavior,
  editing: defaultAccountEditingRhythm,
  preview: defaultAccountPreviewStyle,
  experimentationDegree: 30,
  consistencyStrictness: 70,
  referenceSources: [],
}

export const defaultGroupStylePolicy: GroupStylePolicy = {
  mode: 'independent',
  baseStyle: null,
  overridableSections: [],
}
