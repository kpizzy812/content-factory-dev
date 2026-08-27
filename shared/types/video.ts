export interface VideoAsset {
  id: number
  videoId: number
  type: "image" | "clip" | "music" | "voiceover" | "voiceover_mix" | "transcript"
  prompt: string | null
  filePath: string | null
  fileUrl: string | null
  order: number
  duration: number | null
  createdAt: string
}

export type VideoStatus =
  | "pending"
  | "configuring"
  | "generating_prompts"
  | "generating_images"
  | "generating_clips"
  | "generating_voiceover"
  | "generating_music"
  | "assembling"
  | "completed"
  | "failed"
  | "timeout"
  | "canceled"
  // Пошаговый режим (§9): шаг доведён до конца, ролик ждёт решения оператора.
  // Прогона за ним нет — блокировка отпущена, процесс завершился.
  | "awaiting_operator"

export type VideoStepKey =
  | "prompt_generation"
  | "image_generation"
  | "clip_generation"
  | "voiceover_generation"
  | "transcription"
  | "edit_plan"
  | "shot_background"
  | "music_generation"
  | "assembly"

export type VideoStepStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "canceled"
  | "skipped"

export interface VideoGenerationStep {
  id: number
  stepKey: VideoStepKey
  stepIndex: number
  status: VideoStepStatus
  startedAt: string | null
  finishedAt: string | null
  attemptCount: number
  estimatedCost: number | null
  actualCost: number | null
  logs: Array<{ ts: string; msg: string }> | null
  errorMessage: string | null
  inputSnapshot: unknown
  outputSnapshot: unknown
  // fal.ai tracking
  falRequestId: string | null
  falEndpoint: string | null
  falQueueStatus: string | null
  falLogsSnapshot: unknown
  falSubmittedAt: string | null
  falCompletedAt: string | null
  falCanceledAt: string | null
}

export interface Video {
  id: number
  scenarioId: number
  variantId: number | null
  applicationId: number | null
  status: VideoStatus
  currentStep: string | null
  format: "portrait" | "landscape"
  filePath: string | null
  fileUrl: string | null
  duration: number | null
  errorMessage: string | null
  // Output configuration
  subtitlesEnabled: boolean
  subtitlesStyle: unknown
  musicEnabled: boolean
  musicMood: string | null
  musicDuration: number | null
  renderQuality: string
  targetPlatform: string | null
  // Job safety
  isLocked: boolean
  startedAt: string | null
  finishedAt: string | null
  // Монтаж от звука: профиль, его переопределения и пошаговый режим (§9 спеки).
  // Prisma отдаёт эти поля в `GET /api/videos/:id` вместе с остальными
  // скалярами — типа у них до сих пор не было.
  editProfileId?: number | null
  editOverrides?: unknown
  /** Правки сценария, положенные на ролик заменой фразы. */
  scriptOverrides?: unknown
  /** Переопределение пошагового режима на ролике. `null` — наследовать профиль. */
  stepwiseApproval?: boolean | null
  /** Шаг, решения по которому ждёт ролик в статусе `awaiting_operator`. */
  awaitingStepKey?: VideoStepKey | string | null
  approvedStepKey?: VideoStepKey | string | null
  // Cost tracking
  totalCostEstimate: number | null
  totalCostActual: number | null
  createdAt: string
  updatedAt: string
  assets?: VideoAsset[]
  steps?: VideoGenerationStep[]
  scenario?: {
    id: number
    selectedVariantId?: number | null
    variants?: Array<{
      title: string
      hook?: string
      body?: string
      cta?: string
      visualStyleText?: string
    }>
  } | null
}

export interface VideoListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface VideoProgress {
  id: number
  status: VideoStatus
  currentStep: string | null
  errorMessage: string | null
  format: string
  isLocked: boolean
  startedAt: string | null
  finishedAt: string | null
  subtitlesEnabled: boolean
  musicEnabled: boolean
  musicMood: string | null
  renderQuality: string
  targetPlatform: string | null
  totalCostEstimate: number | null
  totalCostActual: number | null
  assets: Pick<VideoAsset, "id" | "type" | "prompt" | "fileUrl" | "order">[]
  steps: VideoGenerationStep[]
}

export const STEP_LABELS: Record<VideoStepKey, string> = {
  prompt_generation: "Генерация промптов",
  image_generation: "Генерация изображений",
  clip_generation: "Генерация видеоклипов",
  voiceover_generation: "Озвучка (TTS)",
  transcription: "Транскрипция",
  edit_plan: "План монтажа",
  shot_background: "Фоны кадров",
  music_generation: "Генерация музыки",
  assembly: "Сборка видео",
}

// Порядок строк в таблице шагов UI. Не обязан совпадать с персистентным
// stepIndex (server/utils/video-pipeline-db.ts): там transcription в конце
// (история роликов), здесь — сразу после voiceover_generation, потому что
// на маршруте audio-first транскрипция логически идёт следом за озвучкой.
export const STEP_ORDER: VideoStepKey[] = [
  "prompt_generation",
  "image_generation",
  "clip_generation",
  "voiceover_generation",
  "transcription",
  "edit_plan",
  "shot_background",
  "music_generation",
  "assembly",
]

// ─── Cost Estimate Types ───────────────────────────

export interface VideoCostLineItem {
  stage: string
  label: string
  units: number
  unitLabel: string
  unitPrice: number
  subtotal: number
  modelName: string
}

export interface VideoCostEstimateResponse {
  breakdown: VideoCostLineItem[]
  /** Ожидаемая стоимость (середина диапазона) */
  total: number
  /** Минимально возможная стоимость (3 сцены × 3с) */
  minTotal?: number
  /** Максимально возможная стоимость (6 сцен × 9с) */
  maxTotal?: number
  /** Включён ли story-driven режим в расчёте */
  storyDriven?: boolean
  warnings: string[]
  models: {
    image: { id: string; name: string } | null
    video: { id: string; name: string } | null
    music: { id: string; name: string } | null
    tts?: { id: string; name: string } | null
  }
  tips: Array<{
    tip: string
    action: string
    field: string
    newValue: unknown
    savingsPercent: number
  }>
  presets: Array<{
    key: string
    label: string
    description: string
    config: Record<string, unknown>
  }>
}

// ─── Model Access Status ─────────────────────────────

export type ModelAccessStatus =
  | "available"           // Модель доступна текущему ключу
  | "blocked_by_access"   // 403 — ключ/workspace не имеет доступа
  | "no_api_key"          // Ключ fal.ai не настроен или невалиден
  | "unsupported_by_runtime" // Не интегрирована в runtime
  | "probe_error"         // Не удалось проверить

export interface VideoModelInfo {
  id: string
  name: string
  provider: string
  tier: "budget" | "standard" | "premium"
  integrated: boolean
  /** Реальная доступность модели для текущего ключа/workspace */
  accessStatus?: ModelAccessStatus
  /** Человекочитаемая причина недоступности */
  accessReason?: string
  strengths: string[]
  tradeoffs: string[]
  avgGenerationTime?: string
  durationRange?: [number, number]
  durationOptions?: number[]
  pricing: {
    unit: string
    base: number
    withAudio?: number
  }
}
