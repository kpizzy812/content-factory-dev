export type MediaCapability = "lip_sync"
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

export interface MediaModelSpec {
  id: string
  provider: MediaProviderName
  capability: MediaCapability
  priceUsdPerOutputSecond: number
  constraints: LipSyncConstraints
  dataProcessor: {
    name: string
    note: string
  } | null
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
