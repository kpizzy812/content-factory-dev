/**
 * Контракты монтажной консоли для UI.
 *
 * Сервер уже отдаёт всё это (`server/utils/edit-plan/*`, `server/api/videos/[id]/*`,
 * `server/api/characters/[id]/clone-voice.post.ts`), но общих типов у фронта не
 * было: страницы читали ответы как `unknown`. Здесь лежат ровно те поля, что
 * реально приходят по проводу — не больше, чтобы не выдумывать несуществующее.
 *
 * Макет: `design-preview/catalog/09-edit-console.dc.html`.
 */

// ─── Монтажный профиль ───────────────────────────────────────────────────────

export type PipPosition = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'

export const PIP_POSITION_LABELS: Record<PipPosition, string> = {
  top_left: 'Сверху слева',
  top_right: 'Сверху справа',
  bottom_left: 'Снизу слева',
  bottom_right: 'Снизу справа',
}

export const GENERATIVE_VIDEO_RESOLUTIONS = ['1080x1920', '1920x1080', '1080x1080'] as const

/**
 * Ответ `/api/edit-profiles` — `presentEditProfile`: строка профиля плюс
 * разрешённые значения `ResolvedEditProfile`.
 */
export interface EditProfile {
  id: number
  appId: number | null
  name: string
  description: string | null
  isDefault: boolean
  createdAt: string
  updatedAt: string
  editPrompt: string | null
  brollRatio: number
  shotChangeSec: number
  pipEnabled: boolean
  pipPosition: PipPosition
  pipSize: number
  /** Потолок расхода на картинки фона в пределах одного ролика. */
  imageGenerationEnabled: boolean
  imageBudgetUsd: number
  /** Потолок расхода на генеративное видео в пределах одного ролика. */
  generativeVideoEnabled: boolean
  generativeVideoBudgetUsd: number
  generativeVideoResolution: string
  stepwiseApproval: boolean
  llmModelId: string | null
}

// ─── Библиотека фонов ────────────────────────────────────────────────────────

export type BackgroundClipKind = 'screen_recording' | 'footage' | 'image'

export const BACKGROUND_CLIP_KIND_LABELS: Record<BackgroundClipKind, string> = {
  screen_recording: 'Запись экрана',
  footage: 'Съёмка',
  image: 'Картинка',
}

export interface BackgroundClip {
  id: string
  appId: number
  name: string | null
  storageKey: string
  sha1: string
  mimeType: string | null
  /** Prisma отдаёт BigInt строкой — приводить к числу только для отображения. */
  bytes: number | string | null
  durationSec: number | null
  width: number | null
  height: number | null
  kind: BackgroundClipKind | string
  tags: string[]
  isActive: boolean
  usageCount: number
  lastUsedAt: string | null
  createdAt: string
}

// ─── Кадры ───────────────────────────────────────────────────────────────────

export type ShotBackground = 'library' | 'image' | 'video' | 'app_screen' | 'none'
export type ShotForeground = 'presenter' | 'none'

export const SHOT_BACKGROUND_LABELS: Record<ShotBackground, string> = {
  library: 'Библиотека',
  image: 'Картинка',
  video: 'Видео',
  app_screen: 'Скрин приложения',
  none: 'Пусто',
}

/** Фоны, за которые платит провайдер, а не библиотека. */
export const PAID_SHOT_BACKGROUNDS: readonly ShotBackground[] = ['image', 'video']

/**
 * Кадр так, как его видит `edit_plan.outputSnapshot.shots`
 * (`PlannedShotWithCost` в `server/utils/edit-plan/types.ts`).
 */
export interface PlannedShot {
  order: number
  startSec: number
  endSec: number
  sceneOrder: number | null
  foreground: ShotForeground | string
  background: ShotBackground | string
  backgroundClipId: string | null
  appReferenceId: string | null
  idea: string | null
  pipEnabled: boolean
  costUsd: number
  degradeReason: string | null
}

/**
 * Факт исполнения кадра — строка `VideoShot` так, как её отдаёт
 * `GET /api/videos/:id/shots`.
 *
 * Поле `background` (ПЛАН) сюда не входит намеренно: план таблица берёт из
 * снапшота шага `edit_plan`, и дублировать его вторым источником значило бы
 * завести два расходящихся плана на один кадр. Здесь только исполнение.
 *
 * `backgroundActual: null` — шаг `shot_background` до этого кадра ещё не дошёл.
 * Это план БЕЗ факта, а не ошибка и не деградация: строка `VideoShot`
 * появляется сразу на шаге плана (`saveShots`), со `status: 'planned'` и уже
 * посчитанной плановой стоимостью.
 */
export interface ShotFact {
  order: number
  startSec: number
  endSec: number
  /** Сцена сценария, которой принадлежит кадр. `null` — перебивка. */
  sceneOrder: number | null
  backgroundActual: ShotBackground | string | null
  /** planned | rendering | completed | degraded | failed */
  status: string
  /** Плановая стоимость до исполнения, фактическая — после. */
  costUsd: number
  degradeReason: string | null
  assetPath: string | null
  /** Отпечаток собранного кадра. `null` — кадр не собран или хеш не снялся. */
  perceptualHash: string | null
}

/** Строка таблицы кадров: план плюс факт, если он доступен. */
export interface ShotRow {
  order: number
  startSec: number
  endSec: number
  sceneOrder: number | null
  idea: string | null
  withPresenter: boolean
  pipEnabled: boolean
  /** Что было запрошено планом. */
  background: ShotBackground | string
  /** Что реально получилось. `null` — факт неизвестен. */
  backgroundActual: ShotBackground | string | null
  costUsd: number
  status: string
  degradeReason: string | null
  /** Кадр остался без запрошенного фона — оператору надо объяснить почему. */
  degraded: boolean
  /** Повторная сборка снова обратится к платной модели. */
  rerenderPaid: boolean
}

// ─── Пошаговый режим ─────────────────────────────────────────────────────────

export type StepwiseSource = 'video' | 'profile' | 'default'

/** Ответ `POST /api/videos/:id/stepwise`. */
export interface StepwiseState {
  videoId: number
  /** Переопределение на ролике. `null` — наследовать профиль. */
  stepwiseApproval: boolean | null
  /** Чем будет руководствоваться прогон. */
  enabled: boolean
  source: StepwiseSource
  /** Шаг, на котором ролик стоит прямо сейчас. */
  awaitingStepKey: string | null
}

export type StepwiseApprovalAction = 'approve' | 'regenerate' | 'reject'

// ─── Дорогие действия ────────────────────────────────────────────────────────

/**
 * Смета перегенерации трека. Приходит в теле ответа 400, если не прислан
 * `confirmExpensive` — то есть сервер сам не даёт заплатить вслепую.
 */
export interface TrackRegenerationPreview {
  sceneCount: number
  characters: number
  changedSceneOrders: number[]
  voiceChanged: boolean
  /** Кадры, которые придётся собрать заново: обесцениваются ВСЕ. */
  shotsToRebuild: number
  /** Секунды губ, за которые придётся заплатить второй раз. */
  lipSyncSecondsToRepay: number
  estimatedCostUsd: number
}

/** Фиксированная цена прогона клонирования голоса, `replicate:minimax-voice-cloning`. */
export const VOICE_CLONE_USD = 3

export const VOICE_CLONE_SAMPLE_EXTENSIONS = ['.mp3', '.m4a', '.wav'] as const
export const VOICE_CLONE_MIN_SEC = 10
export const VOICE_CLONE_MAX_SEC = 5 * 60
export const VOICE_CLONE_MAX_BYTES = 20 * 1024 * 1024

export type VoiceCloneSource = 'reused_character' | 'reused_storage' | 'cloned'

export interface VoiceCloneResult {
  voiceId: string
  targetModel: string
  sampleSha1: string
  costUsd: number
  source: VoiceCloneSource
}
