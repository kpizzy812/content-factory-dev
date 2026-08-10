/**
 * Типы медиаконтура: способности, спеки моделей, биллинг.
 *
 * Почему спека модели — дискриминированный union по capability: у каждой
 * способности свой нормализованный вход и свои ограничения (lip-sync меряет
 * длительность исходника, изображение — размер кадра, TTS — язык и голос).
 * Один общий интерфейс заставил бы размывать `constraints` и `input` в `any`,
 * и первая же новая модель уехала бы в ветвление по префиксу id — ровно то,
 * от чего мы уходим (см. spec 2026-08-07-replicate-media-contour §3.2).
 */

export type MediaCapability =
  | "lip_sync"
  | "text_to_image"
  | "text_to_video"
  | "image_to_video"
  | "text_to_speech"
// b_roll добавляется отдельным решением (P0-16, §7 спецификации)

export type MediaProviderName = "replicate" | "fal"

/**
 * Модель исполнения задачи у провайдера.
 *  - async_prediction — Replicate: prediction + webhook + recovery + перенос
 *    выхода в наше хранилище (устойчиво к перезапуску процесса);
 *  - sync_queue — fal: сабмит и поллинг внутри одного вызова шага.
 * Ветку выбирает спека модели, а не глобальный флаг и не подстрока в id.
 */
export type MediaExecution = "async_prediction" | "sync_queue"

export type MediaTier = "budget" | "standard" | "premium"

export type MediaPredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"

// ─── Нормализованные входы (провайдеронезависимые) ──────────────

export type MediaAspectRatio = "9:16" | "16:9" | "1:1"

export interface TextToImageInput {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  /** Сколько изображений просим. Наш инвариант — одно на сцену. */
  count: number
  seed?: number
}

export interface TextToVideoInput {
  prompt: string
  negativePrompt?: string
  durationSec: number
  aspectRatio: MediaAspectRatio
  /** Нужна ли встроенная звуковая дорожка (умеет не каждая модель). */
  withAudio: boolean
  resolution?: string
}

export interface ImageToVideoInput extends TextToVideoInput {
  /** Публичный URL опорного кадра (скриншот приложения). */
  imageUrl: string
}

export interface TtsInput {
  text: string
  voiceId: string
  /** Множитель темпа речи (1.0 — нормальный). */
  speed: number
  language: string
  format: string
  /**
   * Подсказка по интонации свободным текстом («лёгкая тревога»). Модели без
   * управления экспрессией её игнорируют, у остальных маппер спеки сводит её
   * к своему закрытому списку — в нормализованном входе гадать нельзя.
   */
  emotion?: string | null
}

export interface LipSyncInput {
  videoUrl: string
  audioUrl: string
}

export interface MediaInputMap {
  lip_sync: LipSyncInput
  text_to_image: TextToImageInput
  text_to_video: TextToVideoInput
  image_to_video: ImageToVideoInput
  text_to_speech: TtsInput
}

export type MediaInputFor<C extends MediaCapability> = MediaInputMap[C]
export type MediaTaskInput = MediaInputMap[MediaCapability]

// ─── Ограничения по способностям ────────────────────────────────

export interface LipSyncConstraints {
  videoExtensions: readonly string[]
  audioExtensions: readonly string[]
  minDurationSec: number
  maxDurationSec: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  maxVideoBytes: number
  maxAudioBytes: number
}

export interface TextToImageConstraints {
  /** Поддерживаемые размеры кадра — для витрины и валидации. */
  resolutions: readonly string[]
  /**
   * Сколько изображений модели разрешено просить за раз. Держим 1 осознанно:
   * разбор выхода (`client.ts extractOutputUrl`) берёт первый url, и при
   * num_images > 1 остальные молча терялись бы (§2.5 п.7).
   */
  maxImagesPerRequest: number
}

export interface VideoModelConstraints {
  aspectRatios: readonly MediaAspectRatio[]
  resolutions?: readonly string[]
  /** Непрерывный диапазон длительности, если модель его поддерживает. */
  durationRange?: readonly [number, number]
  /** Фиксированные варианты длительности (Kling i2v — только 5 или 10). */
  durationOptions?: readonly number[]
  supportsAudio: boolean
  /** Нужен ли опорный кадр (image_to_video). */
  requiresImage: boolean
}

export interface TtsConstraints {
  maxCharacters: number
  languages: readonly string[]
  formats: readonly string[]
}

// ─── Биллинг ────────────────────────────────────────────────────

/**
 * Единица тарификации. Union вместо скаляра, потому что способности считаются
 * по-разному: fal берёт за мегапиксель картинки, Kling — за секунду выхода,
 * ElevenLabs — за символ, а часть моделей Replicate — за секунду железа, и там
 * цена вообще неизвестна до завершения prediction (§3.2).
 */
export type MediaBilling =
  | { unit: "output_image", usdPerImage: number }
  | { unit: "output_megapixel", usdPerMegapixel: number }
  | {
    unit: "output_second"
    usdPerSecond: number
    usdPerSecondWithAudio?: number
    byResolution?: Readonly<Record<string, number>>
  }
  | { unit: "audio_second", usdPerSecond: number }
  | { unit: "character", usdPerCharacter: number }
  | { unit: "hardware_second", usdPerSecond: number, estimatedSeconds: number }
  | { unit: "flat", usd: number }

/**
 * Фактическое потребление для расчёта цены. Все поля опциональны: какое из них
 * обязательно — определяет единица биллинга, и при его отсутствии
 * `estimateMediaCost` падает с внятным текстом, а не считает по нулю.
 */
export interface MediaUsage {
  images?: number
  megapixels?: number
  outputSeconds?: number
  audioSeconds?: number
  characters?: number
  /** Секунды железа из `metrics.predict_time` вебхука (факт для hardware_second). */
  hardwareSeconds?: number
  withAudio?: boolean
  resolution?: string
}

// ─── Спека модели ───────────────────────────────────────────────

/** Контекст маппинга — только для диагностики, на payload не влияет. */
export interface MapContext {
  /** Ключ единицы работы (scene.key) — прямая замена falSubKey. */
  unitKey?: string
  sceneOrder?: number
}

export interface MappedMediaInput {
  payload: Record<string, unknown>
  /**
   * Фактическая длительность после квантования модели (Kling 5|10,
   * Wan num_frames/fps). По ней считаются и деньги, и таймлайн сборки —
   * сегодня длительность молча менялась, а цена бралась по исходной.
   */
  effectiveDurationSec?: number
}

export interface ExtractedMediaOutput {
  urls: string[]
  contentType?: string
}

export interface MediaVoices {
  default: string
  byLanguage?: Readonly<Record<string, string>>
  /**
   * Имя переменной окружения, которая переопределяет голос по умолчанию.
   * Существует ради обратной совместимости с `resolveDefaultVoice`
   * (`tts.ts:77-97`): DEFAULT_TTS_VOICE_EN / DEFAULT_TTS_VOICE_RU.
   */
  envOverrideKey?: string
}

export interface MediaModelSpecBase<
  C extends MediaCapability,
  TInput,
  TConstraints,
> {
  /** Стабильный внутренний ключ, не зависящий от провайдера. */
  registryKey: string
  /** Идентификатор У ПРОВАЙДЕРА: "fal-ai/flux/dev" | "<owner>/<model>". */
  id: string
  /** ЯВНОЕ поле, не подстрока и не префикс id. */
  provider: MediaProviderName
  capability: C
  execution: MediaExecution
  billing: MediaBilling
  /**
   * Подтверждена ли цена страницей модели или счётом аккаунта (§6.1).
   * false — число оценочное, в смету и ledger такую модель пускать нельзя,
   * пока цену не подтвердили.
   */
  billingConfirmed: boolean
  constraints: TConstraints
  /** У способности своя длительность ожидания, а не одна глобальная (§3.4). */
  timeoutMs: number
  mapInput(input: TInput, ctx?: MapContext): MappedMediaInput
  extractOutput(raw: unknown): ExtractedMediaOutput
  voices?: MediaVoices
  dataProcessor: { name: string, note: string } | null
  integrated: boolean
  tier: MediaTier
  // ─── Поля витрины (video-models.ts собирает ModelMeta из них) ───
  name: string
  /** Человекочитаемый вендор для UI ("Black Forest Labs"), не провайдер API. */
  vendorLabel: string
  strengths: readonly string[]
  tradeoffs: readonly string[]
  avgGenerationTime?: string
}

export type LipSyncModelSpec = MediaModelSpecBase<"lip_sync", LipSyncInput, LipSyncConstraints>
export type TextToImageModelSpec = MediaModelSpecBase<"text_to_image", TextToImageInput, TextToImageConstraints>
export type TextToVideoModelSpec = MediaModelSpecBase<"text_to_video", TextToVideoInput, VideoModelConstraints>
export type ImageToVideoModelSpec = MediaModelSpecBase<"image_to_video", ImageToVideoInput, VideoModelConstraints>
export type TextToSpeechModelSpec = MediaModelSpecBase<"text_to_speech", TtsInput, TtsConstraints>

export type MediaModelSpec =
  | LipSyncModelSpec
  | TextToImageModelSpec
  | TextToVideoModelSpec
  | ImageToVideoModelSpec
  | TextToSpeechModelSpec

export type MediaSpecFor<C extends MediaCapability> = Extract<MediaModelSpec, { capability: C }>

// ─── Провайдерный слой (без изменений) ──────────────────────────

export interface NormalizedMediaPrediction {
  externalId: string
  provider: MediaProviderName
  model: string
  status: MediaPredictionStatus
  outputUrl: string | null
  error: string | null
  createdAt: Date | null
  startedAt: Date | null
  completedAt: Date | null
  raw: Record<string, unknown>
}

export interface CreateMediaPredictionInput {
  model: MediaModelSpec
  input: Record<string, unknown>
  webhookUrl: string | null
  idempotencyKey: string
}

export interface MediaProvider {
  readonly name: MediaProviderName
  create(input: CreateMediaPredictionInput): Promise<NormalizedMediaPrediction>
  get(externalId: string): Promise<NormalizedMediaPrediction>
  cancel(externalId: string): Promise<NormalizedMediaPrediction>
}
