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
  | "speech_to_video"
  | "image_to_image"
  | "transcription"
// b_roll добавляется отдельным решением (P0-16, §7 спецификации)

export type MediaProviderName = "replicate" | "fal" | "fish"

/**
 * Модель исполнения задачи у провайдера.
 *  - async_prediction — Replicate: prediction + webhook + recovery + перенос
 *    выхода в наше хранилище (устойчиво к перезапуску процесса);
 *  - sync_queue — fal: сабмит и поллинг внутри одного вызова шага;
 *  - sync_bytes — Fish Audio: аудио приходит БАЙТАМИ в теле ответа, ссылки на
 *    выход нет вовсе, поэтому и разбирать нечего;
 *  - sync_json — Replicate-транскрипция: выход СТРУКТУРА (слова и границы), а
 *    не файл и не ссылка на файл — скачивать нечего.
 * Ветку выбирает спека модели, а не глобальный флаг и не подстрока в id.
 */
export type MediaExecution = "async_prediction" | "sync_queue" | "sync_bytes" | "sync_json"

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

/**
 * Портрет плюс готовая речь — сразу говорящее видео. Отличие от
 * `image_to_video` + `lip_sync` не в экономии вызова, а в том, что мимика и
 * движения выводятся из самой речи: модель знает темп, паузы и ударения, а
 * i2v о них не знает и знать не может (spec 2026-08-14-avatar-pipeline §1).
 */
export interface SpeechToVideoInput {
  /** Публичный URL портрета. */
  imageUrl: string
  /** Публичный URL готового TTS-аудио сцены. */
  audioUrl: string
  /** Длина аудио: по ней считаются деньги и таймлайн, а не по плану сцены. */
  durationSec: number
  /** Спека сводит к ближайшему допустимому значению своей модели. */
  resolution?: string
  /** Поведение в кадре. Модели без такого поля промпт игнорируют. */
  prompt?: string
  negativePrompt?: string
  seed?: number
}

/**
 * Референс плюс инструкция правки — новый кадр того же человека.
 *
 * Отличие от `text_to_image` не в наличии картинки на входе, а в том, что
 * промпт здесь ИНСТРУКЦИЯ («тот же человек, в профиль, у окна»), а не описание
 * с нуля: модель обязана сохранить идентичность лица. Без этого аватарной
 * ротации нужны 5-10 снятых фотографий человека, и это главное требование к
 * заказчику (spec 2026-08-14-avatar-pipeline, этап 5).
 */
export interface ImageToImageInput {
  /** Публичный URL исходного кадра персонажа. */
  imageUrl: string
  /** Инструкция правки. Пустая означает «сделай что-нибудь» — это отказ. */
  prompt: string
  /** Сколько кадров просим. Наш инвариант — один на вызов. */
  count: number
  /**
   * Кадр результата. Не задан — сохраняем пропорции референса: у моделей
   * Kontext для этого есть отдельное значение `match_input_image`.
   */
  width?: number
  height?: number
  seed?: number
}

/**
 * Транскрипция СВОЕЙ озвучки. Текст известен из сценария — нужны границы слов
 * (spec §4.1).
 */
export interface TranscriptionInput {
  /** Публичный URL готового трека озвучки. */
  audioUrl: string
  /** Подсказка языка: для русского заметно повышает точность границ. */
  language?: string
}

export interface MediaInputMap {
  lip_sync: LipSyncInput
  text_to_image: TextToImageInput
  text_to_video: TextToVideoInput
  image_to_video: ImageToVideoInput
  text_to_speech: TtsInput
  speech_to_video: SpeechToVideoInput
  image_to_image: ImageToImageInput
  transcription: TranscriptionInput
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

export interface SpeechToVideoConstraints {
  /** Разрешения, которые модель реально принимает (значения enum её схемы). */
  resolutions: readonly string[]
  /** Потолок длины: у fabric-1.0 — 60 секунд. Проверяется ДО оплаты. */
  maxDurationSec: number
  audioExtensions: readonly string[]
  imageExtensions: readonly string[]
  /** Принимает ли модель текстовое описание поведения в кадре. */
  supportsPrompt: boolean
}

export interface ImageToImageConstraints {
  /** Значения enum `aspect_ratio` из схемы модели, дословно. */
  aspectRatios: readonly string[]
  /** Кадров за запрос: разбор выхода берёт один URL, поэтому один. */
  maxImagesPerRequest: number
  /** Форматы референса, которые модель принимает. */
  inputImageExtensions: readonly string[]
  /**
   * Сохраняет ли модель идентичность лица без дообучения. false означает
   * «похожий человек», и для библиотеки портретов это брак, а не вариация.
   */
  preservesIdentity: boolean
}

export interface TranscriptionConstraints {
  languages: readonly string[]
  /** Потолок длины аудио у модели. Проверяется ДО оплаты. */
  maxDurationSec: number
  audioExtensions: readonly string[]
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
  // Fish Audio считает по UTF-8 байтам, а не символам: кириллица это два
  // байта на букву, то есть вдвое дороже, чем кажется по длине строки.
  | { unit: "utf8_byte", usdPerByte: number }
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
  /** Длина текста в UTF-8 байтах — единица Fish Audio. */
  utf8Bytes?: number
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
   * Существует ради обратной совместимости с прежним выбором голоса в tts.ts:
   * DEFAULT_TTS_VOICE_EN / DEFAULT_TTS_VOICE_RU уже прописаны на стендах.
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
  /**
   * Хеш версии модели у Replicate — обязателен для COMMUNITY-моделей.
   *
   * У официальных моделей Replicate (`Official model` на странице модели) есть
   * эндпоинт `POST /v1/models/{owner}/{name}/predictions`, который сам находит
   * последнюю версию — одного `id` достаточно, `version` не нужен. У
   * community-моделей (например, `openai/whisper`) этого эндпоинта нет: он
   * отвечает 404 (canary 26.08.2026 — `whisper-version-report.md`), а задачу
   * создаёт `POST /v1/predictions` с телом `{ version, input }`.
   *
   * Не задано — `runReplicateJsonModel` идёт прежним путём официальных моделей
   * побайтово без изменений; `minimax/speech-02-turbo` и `kwaivgi/kling-*`
   * этого поля не имеют и трогать их нельзя.
   *
   * Пиннинг версии — не только обход 404, но и детерминизм: тот же довод, что
   * у `EditProfile.llmModelId` в спеке монтажа — поведение модели не должно
   * меняться под ногами между прогонами вслед за «последней версией» автора.
   */
  providerVersion?: string
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
export type SpeechToVideoModelSpec = MediaModelSpecBase<"speech_to_video", SpeechToVideoInput, SpeechToVideoConstraints>
export type ImageToImageModelSpec = MediaModelSpecBase<"image_to_image", ImageToImageInput, ImageToImageConstraints>
export type TranscriptionModelSpec = MediaModelSpecBase<"transcription", TranscriptionInput, TranscriptionConstraints>

export type MediaModelSpec =
  | LipSyncModelSpec
  | TextToImageModelSpec
  | TextToVideoModelSpec
  | ImageToVideoModelSpec
  | TextToSpeechModelSpec
  | SpeechToVideoModelSpec
  | ImageToImageModelSpec
  | TranscriptionModelSpec

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
