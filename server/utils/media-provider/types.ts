export type MediaCapability = "lip_sync" | "tts"
export type MediaProviderName = "replicate" | "fal"

export type MediaPredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"

export interface LipSyncInput {
  videoUrl: string
  audioUrl: string
}

export interface TtsInput {
  text: string
  voiceId: string
  /** Speaking rate multiplier; 1 = provider default. */
  speed: number
  /**
   * ISO language code hint (ru / en / ...). Providers that need a language switch
   * to pronounce non-Latin scripts correctly receive it as their own enum value.
   */
  language: string
  /** Emotional hint; ignored by providers without expressivity control. */
  emotion?: string | null
}

export interface TtsConstraints {
  /** Longest text a single request may carry. */
  maxCharacters: number
  /** Languages the model can pronounce, as ISO codes. */
  languages: readonly string[]
  audioFormat: "mp3" | "wav"
}

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

interface MediaModelBase {
  id: string
  provider: MediaProviderName
  capability: MediaCapability
  dataProcessor: {
    name: string
    note: string
  } | null
}

export interface LipSyncModelSpec extends MediaModelBase {
  capability: "lip_sync"
  priceUsdPerOutputSecond: number
  constraints: LipSyncConstraints
}

export interface TtsModelSpec extends MediaModelBase {
  capability: "tts"
  /** TTS is billed per text length, not per second of produced audio. */
  priceUsdPer1kCharacters: number
  constraints: TtsConstraints
}

export type MediaModelSpec = LipSyncModelSpec | TtsModelSpec

/** Narrows a capability literal to the model spec it resolves to. */
export interface MediaModelSpecByCapability {
  lip_sync: LipSyncModelSpec
  tts: TtsModelSpec
}

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
