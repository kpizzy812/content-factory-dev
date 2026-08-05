/**
 * TTS через Replicate — основной путь синтеза речи.
 *
 * Устроен так же, как lip-sync: predictions идут через prediction-service, поэтому
 * синтез идемпотентен по тексту и голосу, переживает рестарт процесса и подбирается
 * recovery-поллингом, если webhook потерялся. Повторный вызов с тем же текстом не
 * тратит деньги второй раз — возвращается уже сохранённый результат.
 *
 * fal.ai остаётся отдельным путём в server/utils/tts.ts и включается только явно.
 */

import { createHash } from "node:crypto"
import { readReplicateConfig, type ReplicateConfig } from "../replicate/config"
import { createReplicateProvider } from "../replicate/client"
import { createMockReplicateProvider } from "../replicate/mock"
import { createPredictionService, type PredictionSubmission } from "../replicate/prediction-service"
import { requirePaidApisEnabled } from "../paid-guard"
import { getStorageDriver } from "../storage"
import { defaultTtsVoice, estimateTtsCost, mapMediaInput, resolveMediaModel } from "./registry"
import type { MediaProviderName } from "./types"

export interface ReplicateTtsRequest {
  /** Текст одной реплики. */
  text: string
  /** Куда положить готовый аудиофайл. */
  outputPath: string
  /** ISO-код языка (ru / en). */
  language: string
  voiceId?: string | null
  /** Множитель темпа речи; 1 — как у провайдера по умолчанию. */
  speed?: number
  emotion?: string | null
  modelId?: string | null
  /** Привязка к видео — чтобы prediction удалялся вместе с ним. */
  videoId?: number | null
}

export interface ReplicateTtsResult {
  audioPath: string
  provider: MediaProviderName
  modelId: string
  voiceId: string
  predictionId: string | null
  costUsd: number
  characters: number
  idempotencyKey: string
}

export interface RunReplicateTtsDependencies {
  config?: ReplicateConfig
  executePrediction?: (submission: PredictionSubmission) => Promise<{
    predictionId: string
    persistedStorageKey: string
  }>
  materializeOutput?: (storageKey: string, outputPath: string) => Promise<void>
}

export async function runReplicateTts(
  request: ReplicateTtsRequest,
  dependencies: RunReplicateTtsDependencies = {},
): Promise<ReplicateTtsResult> {
  const config = dependencies.config ?? readReplicateConfig()
  const model = resolveMediaModel("tts", request.modelId ?? config.defaultTtsModel)

  const text = request.text?.trim() ?? ""
  if (!text) throw new Error("Replicate TTS: empty text")

  if (!config.mockMode) requirePaidApisEnabled("Replicate")

  const voiceId = request.voiceId?.trim() || defaultTtsVoice()
  const speed = normalizeSpeed(request.speed)
  const language = (request.language || "en").slice(0, 2).toLowerCase()

  const input = mapMediaInput(model, {
    text,
    voiceId,
    speed,
    language,
    emotion: request.emotion ?? null,
  })

  // Ключ считается по самому запросу, а не по сцене: одинаковая реплика тем же
  // голосом переиспользует прошлый синтез, даже если сцена другая.
  const idempotencyKey = [
    "tts",
    "v1",
    "model",
    model.id,
    "input",
    createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  ].join(":")

  const executePrediction = dependencies.executePrediction
    ?? (submission => executeTtsPrediction(submission, config))
  const materializeOutput = dependencies.materializeOutput
    ?? ((storageKey, outputPath) => getStorageDriver().downloadToFile(storageKey, outputPath))

  const execution = await executePrediction({
    videoId: request.videoId ?? null,
    model,
    input,
    webhookUrl: config.webhookUrl,
    idempotencyKey,
  })

  await materializeOutput(execution.persistedStorageKey, request.outputPath)

  return {
    audioPath: request.outputPath,
    provider: "replicate",
    modelId: model.id,
    voiceId,
    predictionId: execution.predictionId,
    costUsd: estimateTtsCost(model, text.length),
    characters: text.length,
    idempotencyKey,
  }
}

async function executeTtsPrediction(
  submission: PredictionSubmission,
  config: ReplicateConfig,
): Promise<{ predictionId: string; persistedStorageKey: string }> {
  const provider = config.mockMode
    ? createMockReplicateProvider({ outputUrl: "mock://audio/tts.mp3" })
    : createReplicateProvider({ config })
  const service = createPredictionService({ provider })

  let prediction = await service.submitOrResumePrediction(submission)
  if (!prediction.persistedStorageKey) {
    // Синтез реплики — это секунды, а не минуты: опрашиваем чаще, чем видео.
    prediction = await service.waitForPrediction(prediction.id, {
      pollIntervalMs: config.mockMode ? 0 : 2_000,
      timeoutMs: 5 * 60 * 1000,
    })
  }
  if (!prediction.persistedStorageKey) {
    throw new Error(`Replicate TTS prediction ${prediction.id} completed without durable output`)
  }

  return {
    predictionId: prediction.id,
    persistedStorageKey: prediction.persistedStorageKey,
  }
}

function normalizeSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed)) return 1
  return Math.min(2, Math.max(0.5, speed))
}
