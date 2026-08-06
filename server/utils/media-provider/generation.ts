/**
 * Генерация кадров и клипов через Replicate.
 *
 * Тот же контур, что у lip-sync и синтеза речи: prediction уходит в
 * prediction-service, результат сразу переносится в постоянное хранилище, а
 * повторный запрос с тем же промптом не создаёт второй платный вызов.
 *
 * fal.ai остаётся в pipeline отдельной веткой и включается только явно.
 */

import { createHash } from "node:crypto"
import { readReplicateConfig, type ReplicateConfig } from "../replicate/config"
import { createReplicateProvider } from "../replicate/client"
import { createMockReplicateProvider } from "../replicate/mock"
import { createPredictionService, type PredictionSubmission } from "../replicate/prediction-service"
import { requirePaidApisEnabled } from "../paid-guard"
import { getStorageDriver } from "../storage"
import { withReplicateRetries } from "./lip-sync"
import {
  estimateImageCost,
  estimateVideoCost,
  mapMediaInput,
  pickDuration,
  resolveMediaModel,
} from "./registry"
import type { MediaProviderName } from "./types"

export interface GenerationRequest {
  videoId: number
  /** Позиция сцены в плане — попадает в ключ идемпотентности. */
  sceneIndex: number
  prompt: string
  format: "portrait" | "landscape"
  outputPath: string
  modelId?: string | null
}

export interface ClipGenerationRequest extends GenerationRequest {
  durationSec: number
  negativePrompt?: string | null
  /** Стартовый кадр — включает image-to-video. */
  startImageUrl?: string | null
}

export interface GenerationResult {
  localPath: string
  provider: MediaProviderName
  modelId: string
  predictionId: string | null
  costUsd: number
  idempotencyKey: string
}

export interface ClipGenerationResult extends GenerationResult {
  /** Длительность, которую реально снимет модель: у неё своя сетка. */
  requestedDurationSec: number
}

export interface GenerationDependencies {
  config?: ReplicateConfig
  executePrediction?: (submission: PredictionSubmission) => Promise<{
    predictionId: string
    persistedStorageKey: string
  }>
  materializeOutput?: (storageKey: string, outputPath: string) => Promise<void>
}

export async function generateImageOnReplicate(
  request: GenerationRequest,
  dependencies: GenerationDependencies = {},
): Promise<GenerationResult> {
  const config = dependencies.config ?? readReplicateConfig()
  const model = resolveMediaModel("image", request.modelId)
  if (!config.mockMode) requirePaidApisEnabled("Replicate")

  const input = mapMediaInput(model, {
    prompt: request.prompt,
    format: request.format,
  })

  const { predictionId, persistedStorageKey, idempotencyKey } = await submit({
    config,
    dependencies,
    videoId: request.videoId,
    model,
    input,
    keyParts: ["image", "v1", "model", model.id, "scene", String(request.sceneIndex)],
    mockOutputUrl: "mock://image/frame.jpg",
  })

  await materialize(dependencies, persistedStorageKey, request.outputPath)

  return {
    localPath: request.outputPath,
    provider: "replicate",
    modelId: model.id,
    predictionId,
    costUsd: estimateImageCost(model, 1),
    idempotencyKey,
  }
}

export async function generateClipOnReplicate(
  request: ClipGenerationRequest,
  dependencies: GenerationDependencies = {},
): Promise<ClipGenerationResult> {
  const config = dependencies.config ?? readReplicateConfig()
  const model = resolveMediaModel("video", request.modelId)
  if (!config.mockMode) requirePaidApisEnabled("Replicate")

  const input = mapMediaInput(model, {
    prompt: request.prompt,
    format: request.format,
    durationSec: request.durationSec,
    negativePrompt: request.negativePrompt ?? null,
    startImageUrl: request.startImageUrl ?? null,
  })
  const requestedDurationSec = pickDuration(model.constraints.durationsSec, request.durationSec)

  const { predictionId, persistedStorageKey, idempotencyKey } = await submit({
    config,
    dependencies,
    videoId: request.videoId,
    model,
    input,
    keyParts: ["video", "v1", "model", model.id, "scene", String(request.sceneIndex)],
    mockOutputUrl: "mock://video/clip.mp4",
  })

  await materialize(dependencies, persistedStorageKey, request.outputPath)

  return {
    localPath: request.outputPath,
    provider: "replicate",
    modelId: model.id,
    predictionId,
    // Платим за то, что сняла модель, а не за то, что попросил план.
    costUsd: estimateVideoCost(model, requestedDurationSec),
    idempotencyKey,
    requestedDurationSec,
  }
}

async function submit(opts: {
  config: ReplicateConfig
  dependencies: GenerationDependencies
  videoId: number
  model: { id: string; capability: string }
  input: Record<string, unknown>
  keyParts: string[]
  mockOutputUrl: string
}): Promise<{ predictionId: string; persistedStorageKey: string; idempotencyKey: string }> {
  // В ключ входит и сам промпт: правка сцены обязана дать новый кадр, а
  // повторный запуск того же плана — переиспользовать оплаченный результат.
  const idempotencyKey = [
    ...opts.keyParts,
    "video-id",
    String(opts.videoId),
    "input",
    createHash("sha256").update(JSON.stringify(opts.input)).digest("hex"),
  ].join(":")

  const execute = opts.dependencies.executePrediction
    ?? (submission => executeGenerationPrediction(submission, opts.config, opts.mockOutputUrl))

  const execution = await withReplicateRetries(
    () => execute({
      videoId: opts.videoId,
      model: opts.model as never,
      input: opts.input,
      webhookUrl: opts.config.webhookUrl,
      idempotencyKey,
    }),
    ms => new Promise(resolve => setTimeout(resolve, ms)),
  )

  return { ...execution, idempotencyKey }
}

async function materialize(
  dependencies: GenerationDependencies,
  storageKey: string,
  outputPath: string,
): Promise<void> {
  const materializeOutput = dependencies.materializeOutput
    ?? ((key: string, path: string) => getStorageDriver().downloadToFile(key, path))
  await materializeOutput(storageKey, outputPath)
}

async function executeGenerationPrediction(
  submission: PredictionSubmission,
  config: ReplicateConfig,
  mockOutputUrl: string,
): Promise<{ predictionId: string; persistedStorageKey: string }> {
  const provider = config.mockMode
    ? createMockReplicateProvider({ outputUrl: mockOutputUrl })
    : createReplicateProvider({ config })
  const service = createPredictionService({ provider })

  let prediction = await service.submitOrResumePrediction(submission)
  if (!prediction.persistedStorageKey) {
    prediction = await service.waitForPrediction(prediction.id, {
      pollIntervalMs: config.mockMode ? 0 : 5_000,
      // Клип Kling снимается минутами, а не секундами.
      timeoutMs: 20 * 60 * 1000,
    })
  }
  if (!prediction.persistedStorageKey) {
    throw new Error(`Replicate prediction ${prediction.id} completed without durable output`)
  }

  return {
    predictionId: prediction.id,
    persistedStorageKey: prediction.persistedStorageKey,
  }
}
