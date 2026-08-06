import { DEFAULT_REPLICATE_LIPSYNC_MODEL, DEFAULT_REPLICATE_TTS_MODEL } from "../replicate/config"
import type {
  ImageInput,
  ImageModelSpec,
  LipSyncInput,
  LipSyncModelSpec,
  MediaCapability,
  MediaModelSpec,
  MediaModelSpecByCapability,
  TtsInput,
  TtsModelSpec,
  VideoInput,
  VideoModelSpec,
} from "./types"

const KLING_LIP_SYNC: LipSyncModelSpec = Object.freeze({
  id: DEFAULT_REPLICATE_LIPSYNC_MODEL,
  provider: "replicate",
  capability: "lip_sync",
  priceUsdPerOutputSecond: 0.014,
  constraints: Object.freeze({
    videoExtensions: Object.freeze(["mp4", "mov"]),
    audioExtensions: Object.freeze(["mp3", "wav", "m4a", "aac"]),
    minDurationSec: 2,
    maxDurationSec: 10,
    minWidth: 720,
    maxWidth: 1080,
    minHeight: 720,
    maxHeight: 1920,
    maxVideoBytes: 100 * 1024 * 1024,
    maxAudioBytes: 5 * 1024 * 1024,
  }),
  dataProcessor: Object.freeze({
    name: "Kuaishou",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
})

/**
 * MiniMax speech-02-turbo — основная TTS-модель. Русский произносит на родном
 * уровне, в отличие от Kokoro, у которого русского языка нет вовсе.
 *
 * Цену Replicate отдаёт только в личном кабинете, поэтому дефолт можно
 * переопределить через REPLICATE_TTS_PRICE_USD_PER_1K_CHARS, не трогая код.
 */
const MINIMAX_SPEECH_02_TURBO: TtsModelSpec = Object.freeze({
  id: DEFAULT_REPLICATE_TTS_MODEL,
  provider: "replicate",
  capability: "tts",
  priceUsdPer1kCharacters: readTtsPrice(),
  constraints: Object.freeze({
    maxCharacters: 5000,
    languages: Object.freeze(["ru", "en"]),
    audioFormat: "mp3",
  }),
  dataProcessor: Object.freeze({
    name: "MiniMax",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
})

/**
 * Голоса MiniMax задаются собственными идентификаторами, а не ISO-кодами языка,
 * и списка допустимых значений схема модели не публикует — там просто строка.
 * Проверено живыми вызовами: `Wise_Woman` и `Calm_Woman` работают и читают
 * русский, а языковые варианты вроде `Russian_Wiselady` модель отвергает.
 * Женский голос по умолчанию — ведущая в кадре женщина.
 */
const MINIMAX_DEFAULT_VOICE = "Wise_Woman"

function configuredTtsVoice(): string {
  return process.env.REPLICATE_TTS_VOICE?.trim() || MINIMAX_DEFAULT_VOICE
}

/** MiniMax принимает язык отдельным полем language_boost, в своей нотации. */
const MINIMAX_LANGUAGE_BOOST: Record<string, string> = {
  ru: "Russian",
  en: "English",
}

/**
 * Эмоция у MiniMax — закрытый список, а сценарист пишет её свободным текстом
 * («лёгкая тревога», «тёплая уверенность»). Непонятое не угадываем: провайдер
 * сам выберет интонацию по тексту, а неизвестное значение уронило бы запрос.
 */
const MINIMAX_EMOTIONS = new Set([
  "auto", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "neutral",
])

const EMOTION_HINTS: Array<{ match: RegExp; emotion: string }> = [
  { match: /радост|восторг|happy|joy/i, emotion: "happy" },
  { match: /груст|печал|sad/i, emotion: "sad" },
  { match: /злост|раздраж|гнев|angry/i, emotion: "angry" },
  { match: /страх|тревог|fear|anxious/i, emotion: "fearful" },
  { match: /удивл|изумл|surprise/i, emotion: "surprised" },
  { match: /спокой|уверен|ясност|calm|confident/i, emotion: "calm" },
]

function normalizeEmotion(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase()
  if (!value) return null
  if (MINIMAX_EMOTIONS.has(value)) return value
  return EMOTION_HINTS.find(hint => hint.match.test(value))?.emotion ?? null
}

/**
 * FLUX.1 [dev] — генерация кадров. Списка 9:16 у модели нет: самая близкая
 * вертикаль — 2:3. Для превью этого достаточно, а сцены всё равно снимает
 * text-to-video напрямую, без промежуточной картинки.
 */
const FLUX_DEV: ImageModelSpec = Object.freeze({
  id: "black-forest-labs/flux-dev",
  provider: "replicate",
  capability: "image",
  priceUsdPerImage: readPrice("REPLICATE_IMAGE_PRICE_USD", 0.025),
  constraints: Object.freeze({
    aspectRatios: Object.freeze(["1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4"]),
    outputFormat: "jpg",
  }),
  dataProcessor: Object.freeze({
    name: "Black Forest Labs",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
})

/**
 * Kling 1.6 Standard — единственная из проверенных моделей Kuaishou на
 * Replicate, которая умеет и text-to-video, и image-to-video. Длительность
 * принимает только 5 или 10 секунд, поэтому сцену на 9 секунд она снимет
 * десятисекундной, а лишнее подрежет монтаж.
 */
const KLING_VIDEO_16_STANDARD: VideoModelSpec = Object.freeze({
  id: "kwaivgi/kling-v1.6-standard",
  provider: "replicate",
  capability: "video",
  priceUsdPerOutputSecond: readPrice("REPLICATE_VIDEO_PRICE_USD_PER_SEC", 0.045),
  constraints: Object.freeze({
    aspectRatios: Object.freeze(["16:9", "9:16", "1:1"]),
    durationsSec: Object.freeze([5, 10]),
    supportsStartImage: true,
  }),
  dataProcessor: Object.freeze({
    name: "Kuaishou",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
})

const MODELS = new Map<string, MediaModelSpec>([
  [KLING_LIP_SYNC.id, KLING_LIP_SYNC],
  [MINIMAX_SPEECH_02_TURBO.id, MINIMAX_SPEECH_02_TURBO],
  [FLUX_DEV.id, FLUX_DEV],
  [KLING_VIDEO_16_STANDARD.id, KLING_VIDEO_16_STANDARD],
])

const DEFAULT_MODELS: Record<MediaCapability, string> = {
  lip_sync: KLING_LIP_SYNC.id,
  tts: MINIMAX_SPEECH_02_TURBO.id,
  image: FLUX_DEV.id,
  video: KLING_VIDEO_16_STANDARD.id,
}

export function resolveMediaModel<C extends MediaCapability>(
  capability: C,
  modelId?: string | null,
): MediaModelSpecByCapability[C] {
  if (!Object.hasOwn(DEFAULT_MODELS, capability)) {
    throw new Error(`Unsupported media capability: ${String(capability)}`)
  }

  const resolvedId = modelId?.trim() || DEFAULT_MODELS[capability]
  const model = MODELS.get(resolvedId)
  if (!model || model.capability !== capability) {
    throw new Error(`Unsupported media model for ${capability}: ${resolvedId}`)
  }
  return model as MediaModelSpecByCapability[C]
}

export function mapMediaInput(model: LipSyncModelSpec, input: LipSyncInput): Record<string, unknown>
export function mapMediaInput(model: TtsModelSpec, input: TtsInput): Record<string, unknown>
export function mapMediaInput(model: ImageModelSpec, input: ImageInput): Record<string, unknown>
export function mapMediaInput(model: VideoModelSpec, input: VideoInput): Record<string, unknown>
export function mapMediaInput(
  model: MediaModelSpec,
  input: LipSyncInput | TtsInput | ImageInput | VideoInput,
): Record<string, unknown> {
  if (model.capability === "lip_sync") {
    const lipSync = input as LipSyncInput
    if (!lipSync.videoUrl?.trim() || !lipSync.audioUrl?.trim()) {
      throw new Error("Lip-sync input requires both videoUrl and audioUrl")
    }
    return {
      video_url: lipSync.videoUrl,
      audio_file: lipSync.audioUrl,
    }
  }

  if (model.capability === "tts") {
    const tts = input as TtsInput
    const text = tts.text?.trim()
    if (!text) {
      throw new Error("TTS input requires non-empty text")
    }
    if (text.length > model.constraints.maxCharacters) {
      throw new Error(
        `TTS input exceeds ${model.constraints.maxCharacters} characters for ${model.id}`,
      )
    }
    const language = (tts.language || "en").slice(0, 2).toLowerCase()
    if (!model.constraints.languages.includes(language)) {
      throw new Error(`Model ${model.id} does not support language "${language}"`)
    }
    const emotion = normalizeEmotion(tts.emotion)
    return {
      text,
      speed: tts.speed,
      voice_id: tts.voiceId?.trim() || configuredTtsVoice(),
      // "Automatic" — значение из enum модели; "auto" она не принимает.
      language_boost: MINIMAX_LANGUAGE_BOOST[language] ?? "Automatic",
      ...(emotion ? { emotion } : {}),
    }
  }

  if (model.capability === "image") {
    const image = input as ImageInput
    const prompt = image.prompt?.trim()
    if (!prompt) throw new Error("Image input requires a non-empty prompt")
    return {
      prompt,
      aspect_ratio: pickAspectRatio(model.constraints.aspectRatios, image.format),
      output_format: model.constraints.outputFormat,
      num_outputs: 1,
    }
  }

  if (model.capability === "video") {
    const video = input as VideoInput
    const prompt = video.prompt?.trim()
    if (!prompt) throw new Error("Video input requires a non-empty prompt")
    if (video.startImageUrl && !model.constraints.supportsStartImage) {
      throw new Error(`Model ${model.id} does not accept a start image`)
    }
    return {
      prompt,
      duration: pickDuration(model.constraints.durationsSec, video.durationSec),
      aspect_ratio: pickAspectRatio(model.constraints.aspectRatios, video.format),
      ...(video.negativePrompt ? { negative_prompt: video.negativePrompt } : {}),
      ...(video.startImageUrl ? { start_image: video.startImageUrl } : {}),
    }
  }

  throw new Error(`Cannot map input for unsupported capability: ${(model as MediaModelSpec).capability}`)
}

/**
 * Вертикаль просим настоящую, если модель её знает. Если нет — берём самую
 * узкую из доступных: обрезать лишнее по краям дешевле, чем дорисовывать.
 */
function pickAspectRatio(supported: readonly string[], format: "portrait" | "landscape"): string {
  if (format === "landscape") {
    return supported.includes("16:9") ? "16:9" : supported[0]!
  }
  const portraitPreference = ["9:16", "2:3", "3:4", "4:5", "1:1"]
  return portraitPreference.find(ratio => supported.includes(ratio)) ?? supported[0]!
}

/**
 * Модель снимает не любую длительность, а из своего набора. Берём ближайшую
 * не меньше запрошенной — лишнее подрежет монтаж, а вот недостачу не восполнить.
 */
export function pickDuration(supported: readonly number[], requestedSec: number): number {
  const sorted = [...supported].sort((a, b) => a - b)
  return sorted.find(value => value >= requestedSec) ?? sorted[sorted.length - 1]!
}

export function estimateMediaCost(model: LipSyncModelSpec, outputDurationSec: number): number {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec < 0) {
    throw new Error("Output duration must be a non-negative finite number")
  }
  return model.priceUsdPerOutputSecond * outputDurationSec
}

export function estimateTtsCost(model: TtsModelSpec, characters: number): number {
  if (!Number.isFinite(characters) || characters < 0) {
    throw new Error("Character count must be a non-negative finite number")
  }
  return (characters / 1000) * model.priceUsdPer1kCharacters
}

export function defaultTtsVoice(): string {
  return configuredTtsVoice()
}

export function estimateImageCost(model: ImageModelSpec, imageCount: number): number {
  if (!Number.isFinite(imageCount) || imageCount < 0) {
    throw new Error("Image count must be a non-negative finite number")
  }
  return model.priceUsdPerImage * imageCount
}

export function estimateVideoCost(model: VideoModelSpec, outputDurationSec: number): number {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec < 0) {
    throw new Error("Output duration must be a non-negative finite number")
  }
  return model.priceUsdPerOutputSecond * outputDurationSec
}

function readTtsPrice(): number {
  return readPrice("REPLICATE_TTS_PRICE_USD_PER_1K_CHARS", 0.06)
}

/**
 * Replicate не отдаёт цены через публичный API, поэтому дефолт можно
 * переопределить переменной окружения, не трогая код.
 */
function readPrice(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${envKey} must be a non-negative number`)
  }
  return parsed
}
