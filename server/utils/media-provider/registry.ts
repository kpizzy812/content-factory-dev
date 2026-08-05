import { DEFAULT_REPLICATE_LIPSYNC_MODEL, DEFAULT_REPLICATE_TTS_MODEL } from "../replicate/config"
import type {
  LipSyncInput,
  LipSyncModelSpec,
  MediaCapability,
  MediaModelSpec,
  MediaModelSpecByCapability,
  TtsInput,
  TtsModelSpec,
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
 * Голоса MiniMax задаются собственными идентификаторами, а не ISO-кодами языка.
 * Женский голос по умолчанию — ведущая в кадре женщина.
 */
const MINIMAX_DEFAULT_VOICE = "Wise_Woman"

/** MiniMax принимает язык отдельным полем language_boost, в своей нотации. */
const MINIMAX_LANGUAGE_BOOST: Record<string, string> = {
  ru: "Russian",
  en: "English",
}

const MODELS = new Map<string, MediaModelSpec>([
  [KLING_LIP_SYNC.id, KLING_LIP_SYNC],
  [MINIMAX_SPEECH_02_TURBO.id, MINIMAX_SPEECH_02_TURBO],
])

const DEFAULT_MODELS: Record<MediaCapability, string> = {
  lip_sync: KLING_LIP_SYNC.id,
  tts: MINIMAX_SPEECH_02_TURBO.id,
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
export function mapMediaInput(
  model: MediaModelSpec,
  input: LipSyncInput | TtsInput,
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
    return {
      text,
      voice_id: tts.voiceId?.trim() || MINIMAX_DEFAULT_VOICE,
      speed: tts.speed,
      language_boost: MINIMAX_LANGUAGE_BOOST[language] ?? "auto",
      ...(tts.emotion ? { emotion: tts.emotion } : {}),
    }
  }

  throw new Error(`Cannot map input for unsupported capability: ${(model as MediaModelSpec).capability}`)
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
  return MINIMAX_DEFAULT_VOICE
}

function readTtsPrice(): number {
  const raw = process.env.REPLICATE_TTS_PRICE_USD_PER_1K_CHARS?.trim()
  if (!raw) return 0.06
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("REPLICATE_TTS_PRICE_USD_PER_1K_CHARS must be a non-negative number")
  }
  return parsed
}
