// --- Scene Composer (F2) shared types ---

/** Тип блока сцены. */
export type SceneBlockKind =
  | 'character'      // выбор Character из библиотеки + роль/действие/эмоция в сцене
  | 'style'          // визуальный стиль/жанр/цветокор/освещение/камера
  | 'environment'    // место действия, время суток, погода
  | 'action'         // что происходит — глаголы, сюжет, диалог в кадре
  | 'app_context'    // контекст приложения (продукт, value-prop)
  | 'app_screen'     // конкретный скриншот приложения (AppReferenceImage)

export const SCENE_BLOCK_KINDS: SceneBlockKind[] = ['character', 'style', 'environment', 'action', 'app_context', 'app_screen']

export const SCENE_BLOCK_LABELS: Record<SceneBlockKind, string> = {
  character: 'Персонаж',
  style: 'Стиль',
  environment: 'Окружение',
  action: 'Действие',
  app_context: 'Контекст приложения',
  app_screen: 'Скрин экрана',
}

export const SCENE_BLOCK_ICONS: Record<SceneBlockKind, string> = {
  character: 'mingcute:user-3-line',
  style: 'mingcute:palette-line',
  environment: 'mingcute:tree-2-line',
  action: 'mingcute:walk-line',
  app_context: 'mingcute:cellphone-2-line',
  app_screen: 'mingcute:phone-line',
}

/** Базовое поле id для блока — UUID или ulid, генерируется на клиенте при добавлении. */
export interface SceneBlockBase {
  id: string
  kind: SceneBlockKind
}

export interface CharacterSceneBlock extends SceneBlockBase {
  kind: 'character'
  characterId: string
  /** Что персонаж делает в сцене: "общается с Б", "трясёт руками" */
  action?: string
  emotion?: string
  /** На какой роли — переопределяет дефолтный role персонажа. */
  roleOverride?: 'protagonist' | 'support' | 'extra'
}

export interface StyleSceneBlock extends SceneBlockBase {
  kind: 'style'
  /** Описание стиля: "кинематографичный, тёплая палитра, лёгкая зернистость" */
  visualStyle: string
  mood?: string
  camera?: string
}

export interface EnvironmentSceneBlock extends SceneBlockBase {
  kind: 'environment'
  location: string
  lighting?: string
  timeOfDay?: string
  weather?: string
}

export interface ActionSceneBlock extends SceneBlockBase {
  kind: 'action'
  /** Сюжет/действие, основной текст. */
  description: string
  dialog?: string
}

export interface AppContextSceneBlock extends SceneBlockBase {
  kind: 'app_context'
  /** Что показать про приложение: фичу, value-prop, transformation. */
  focus: string
}

export interface AppScreenSceneBlock extends SceneBlockBase {
  kind: 'app_screen'
  /** AppReferenceImage.id */
  referenceImageId: string
  /** Какое намерение: "реакция на интерфейс", "use of feature" */
  intent?: string
}

export type SceneBlock =
  | CharacterSceneBlock
  | StyleSceneBlock
  | EnvironmentSceneBlock
  | ActionSceneBlock
  | AppContextSceneBlock
  | AppScreenSceneBlock

export type SceneStatus = 'draft' | 'ready' | 'generating' | 'done'

export const SCENE_STATUS_LABELS: Record<SceneStatus, string> = {
  draft: 'Черновик',
  ready: 'Готово',
  generating: 'Генерируется',
  done: 'Готовое видео',
}

export interface Scene {
  id: string
  appId: number
  name: string
  description?: string | null
  blocks: SceneBlock[]
  promptCompiled?: string | null
  negativeCompiled?: string | null
  tags: string[]
  status: SceneStatus
  generatedScenarioId?: number | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

/** Тип эталонного кадра сцены, аналог CharacterReferenceKind для F2. */
export type SceneReferenceKind = 'mood' | 'shot' | 'environment' | 'other'

export const SCENE_REFERENCE_KINDS: SceneReferenceKind[] = ['mood', 'shot', 'environment', 'other']

export const SCENE_REFERENCE_KIND_LABELS: Record<SceneReferenceKind, string> = {
  mood: 'Настроение',
  shot: 'Композиция кадра',
  environment: 'Локация',
  other: 'Другое',
}

export interface SceneReferenceImage {
  id: string
  sceneId: string
  kind: SceneReferenceKind
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
  aiTags?: string[]
  aiCaption?: string | null
  aiVisualDescription?: string | null
  aiAnalyzedAt?: string | null
  aiError?: string | null
  aiAttempts?: number
  /** Промт, использованный для AI-генерации этого кадра (если он сгенерирован через fal.ai) */
  generationPrompt?: string | null
  /** Идентификатор модели генерации, например "fal-ai/flux/schnell" */
  generationModel?: string | null
  /** Фактическая стоимость генерации в $ (с точностью до 6 знаков) */
  generationCostUsd?: number | string | null
}

export interface SceneCreatePayload {
  appId: number
  name: string
  description?: string
  blocks?: SceneBlock[]
  tags?: string[]
}

export interface SceneUpdatePayload {
  name?: string
  description?: string | null
  blocks?: SceneBlock[]
  tags?: string[]
  status?: SceneStatus
  archived?: boolean
}
