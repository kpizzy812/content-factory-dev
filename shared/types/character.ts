// --- Character Library (F1) shared types ---

/** Роль персонажа в сцене. UI-ярлык для composer'а — не влияет на права. */
export type CharacterRole = 'protagonist' | 'support' | 'extra'

/** Тип референс-изображения. Composer выбирает релевантный kind по ракурсу сцены. */
export type CharacterReferenceKind = 'face' | 'body' | 'outfit' | 'pose' | 'other'

export const CHARACTER_REFERENCE_KINDS: CharacterReferenceKind[] = ['face', 'body', 'outfit', 'pose', 'other']

export const CHARACTER_REFERENCE_KIND_LABELS: Record<CharacterReferenceKind, string> = {
  face: 'Лицо',
  body: 'Тело',
  outfit: 'Одежда',
  pose: 'Поза',
  other: 'Другое',
}

export const CHARACTER_ROLE_LABELS: Record<CharacterRole, string> = {
  protagonist: 'Главный',
  support: 'Второстепенный',
  extra: 'Массовка',
}

export interface CharacterReferenceImage {
  id: string
  characterId: string
  kind: CharacterReferenceKind
  fileUrl: string
  storageKey?: string | null
  storageProvider: string
  sha1: string
  mimeType?: string | null
  bytes?: number | null
  width?: number | null
  height?: number | null
  order: number
  createdAt: string
  /** AI vision разметка — теги внешности (gender_*, age_*, hair_*, outfit_*, ...) */
  aiTags?: string[]
  /** Человеко-читаемое описание фото на русском */
  aiCaption?: string | null
  /** Английский 1-line prompt-инжектор для video-генератора */
  aiVisualDescription?: string | null
  aiAnalyzedAt?: string | null
  aiError?: string | null
  aiAttempts?: number
  /** Промт, использованный для AI-генерации этого фото (если оно сгенерировано через fal.ai) */
  generationPrompt?: string | null
  /** Идентификатор модели генерации, например "fal-ai/flux/schnell" */
  generationModel?: string | null
  /** Фактическая стоимость генерации в $ (с точностью до 6 знаков) */
  generationCostUsd?: number | string | null
}

/**
 * Реальный talking-head фрагмент ведущего из библиотеки исходников.
 * Кандидат для lip-sync: pipeline берёт наименее использованный клип подходящей длины.
 */
export interface PresenterSourceClip {
  id: string
  characterId: string
  name?: string | null
  fileUrl: string
  storageKey?: string | null
  storageProvider: string
  sha1: string
  mimeType?: string | null
  bytes?: number | null
  /** Длительность исходника. Kling принимает только 2-10 секунд. */
  durationSec: number
  width?: number | null
  height?: number | null
  tags: string[]
  outfit?: string | null
  background?: string | null
  gesture?: string | null
  isActive: boolean
  usageCount: number
  lastUsedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface Character {
  id: string
  appId: number
  name: string
  description?: string | null
  role: CharacterRole
  visualPrompt?: string | null
  tags: string[]
  emotionDefault?: string | null
  ageRange?: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
  referenceImages?: CharacterReferenceImage[]
  sourceClips?: PresenterSourceClip[]
}

/** Payload для POST /api/characters */
export interface CharacterCreatePayload {
  appId: number
  name: string
  description?: string
  role?: CharacterRole
  visualPrompt?: string
  tags?: string[]
  emotionDefault?: string
  ageRange?: string
}

/** Payload для PUT /api/characters/:id */
export interface CharacterUpdatePayload {
  name?: string
  description?: string | null
  role?: CharacterRole
  visualPrompt?: string | null
  tags?: string[]
  emotionDefault?: string | null
  ageRange?: string | null
  archived?: boolean
}
