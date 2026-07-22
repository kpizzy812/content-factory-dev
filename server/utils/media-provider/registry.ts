import { DEFAULT_REPLICATE_LIPSYNC_MODEL } from "../replicate/config"
import type {
  LipSyncInput,
  MediaCapability,
  MediaModelSpec,
} from "./types"

const KLING_LIP_SYNC: MediaModelSpec = Object.freeze({
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

const MODELS = new Map<string, MediaModelSpec>([
  [KLING_LIP_SYNC.id, KLING_LIP_SYNC],
])

const DEFAULT_MODELS: Record<MediaCapability, string> = {
  lip_sync: KLING_LIP_SYNC.id,
}

export function resolveMediaModel(
  capability: MediaCapability,
  modelId?: string | null,
): MediaModelSpec {
  if (!Object.hasOwn(DEFAULT_MODELS, capability)) {
    throw new Error(`Unsupported media capability: ${String(capability)}`)
  }

  const resolvedId = modelId?.trim() || DEFAULT_MODELS[capability]
  const model = MODELS.get(resolvedId)
  if (!model || model.capability !== capability) {
    throw new Error(`Unsupported media model for ${capability}: ${resolvedId}`)
  }
  return model
}

export function mapMediaInput(
  model: MediaModelSpec,
  input: LipSyncInput,
): Record<string, unknown> {
  if (model.capability !== "lip_sync") {
    throw new Error(`Cannot map input for unsupported capability: ${model.capability}`)
  }
  if (!input.videoUrl.trim() || !input.audioUrl.trim()) {
    throw new Error("Lip-sync input requires both videoUrl and audioUrl")
  }

  return {
    video_url: input.videoUrl,
    audio_file: input.audioUrl,
  }
}

export function estimateMediaCost(model: MediaModelSpec, outputDurationSec: number): number {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec < 0) {
    throw new Error("Output duration must be a non-negative finite number")
  }
  return model.priceUsdPerOutputSecond * outputDurationSec
}
