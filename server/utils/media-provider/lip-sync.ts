import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { extname } from "node:path"
import { falPollUntilDone, falSubmit, falUploadFile } from "../fal"
import { requirePaidApisEnabled } from "../paid-guard"
import { getStorageDriver } from "../storage"
import { downloadFile } from "../video-helpers"
import { readReplicateConfig, type ReplicateConfig } from "../replicate/config"
import {
  createReplicateInputUploader,
  createReplicateProvider,
  type UploadedReplicateInput,
} from "../replicate/client"
import { ReplicateProviderError } from "../replicate/errors"
import { createMockReplicateProvider } from "../replicate/mock"
import {
  createPredictionService,
  type PredictionSubmission,
} from "../replicate/prediction-service"
import { buildLipSyncIdentity } from "./lip-sync-identity"
import { estimateMediaCost, mapMediaInput, resolveMediaModel } from "./registry"
import type { MediaProviderName } from "./types"

// Лимит запросов у Replicate жёсткий: на небольшом балансе это один запрос за
// раз. Пайплайн ставит TTS и lip-sync подряд, поэтому упереться в 429 —
// нормальный режим работы, а не сбой; переживать его надо молча.
const REPLICATE_MAX_ATTEMPTS = 5
const REPLICATE_RETRY_DELAY_MS = 5_000
const FAL_LIP_SYNC_REGISTRY_KEY = "fal:sync-lipsync"

/**
 * Резервная fal-модель берётся из реестра, а не из литералов: раньше её id и
 * цена $0.067 жили здесь копией того, что записано в спеке, и равенство
 * держалось вручную. Читаем лениво — реестр смотрит в env, и на этапе импорта
 * модуля этого делать нельзя.
 */
function falLipSyncSpec() {
  return resolveMediaModel("lip_sync", FAL_LIP_SYNC_REGISTRY_KEY)
}

export interface LipSyncRequest {
  videoId: number
  videoAssetId?: number | null
  sceneOrder: number
  sourceVideoPath: string
  audioPath: string
  outputPath: string
  durationSec: number
  modelId?: string | null
}

export interface LipSyncResult {
  localPath: string
  provider: MediaProviderName
  modelId: string
  predictionId: string | null
  costUsd: number
  idempotencyKey?: string
}

export interface ReplicatePredictionExecution {
  predictionId: string
  persistedStorageKey: string
}

export interface RunLipSyncDependencies {
  config?: ReplicateConfig
  fingerprintFile?: (path: string) => Promise<string>
  uploadReplicateInput?: (path: string, contentType: string) => Promise<UploadedReplicateInput>
  deleteReplicateInput?: (id: string) => Promise<void>
  executeReplicatePrediction?: (
    submission: PredictionSubmission,
  ) => Promise<ReplicatePredictionExecution>
  materializeOutput?: (storageKey: string, outputPath: string) => Promise<void>
  runFal?: (request: LipSyncRequest) => Promise<LipSyncResult>
  sleep?: (ms: number) => Promise<void>
}

export class MediaProviderRetriesExhaustedError extends Error {
  constructor(
    public readonly provider: MediaProviderName,
    public readonly attempts: number,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`${provider} failed after ${attempts} attempts: ${reason}`, {
      cause: cause instanceof Error ? cause : undefined,
    })
    this.name = "MediaProviderRetriesExhaustedError"
  }
}

export async function runLipSync(
  request: LipSyncRequest,
  dependencies: RunLipSyncDependencies = {},
): Promise<LipSyncResult> {
  const config = dependencies.config ?? readReplicateConfig()
  const model = resolveMediaModel("lip_sync", request.modelId ?? config.defaultLipSyncModel)
  assertSupportedDuration(request.durationSec, model.constraints.minDurationSec, model.constraints.maxDurationSec)

  if (!config.mockMode) requirePaidApisEnabled("Replicate")

  const fingerprintFile = dependencies.fingerprintFile ?? sha256File
  const [sourceIdentity, audioIdentity] = await Promise.all([
    fingerprintFile(request.sourceVideoPath),
    fingerprintFile(request.audioPath),
  ])
  const { attemptScope, attemptCeilingScope, idempotencyKey } = buildLipSyncIdentity({
    videoId: request.videoId,
    sceneOrder: request.sceneOrder,
    modelId: model.id,
    sourceFingerprint: sourceIdentity,
    audioFingerprint: audioIdentity,
  })

  const uploader = createReplicateInputUploader(config)
  const uploadReplicateInput = dependencies.uploadReplicateInput
    ?? ((path, contentType) => uploader.uploadFile(path, contentType))
  const deleteReplicateInput = dependencies.deleteReplicateInput
    ?? (id => uploader.deleteFile(id))
  const executeReplicatePrediction = dependencies.executeReplicatePrediction
    // Длительность заказа доезжает до мок-провайдера: заглушка обязана отдать
    // клип той длины, которую попросили, иначе проверка длины ничего не значит.
    // Боевой провайдер её игнорирует — там длину задаёт исходник.
    ?? (submission => executePrediction(submission, config, request.durationSec))
  const materializeOutput = dependencies.materializeOutput
    ?? ((storageKey, outputPath) => getStorageDriver().downloadToFile(storageKey, outputPath))
  const runFal = dependencies.runFal ?? executeFalLipSync
  const sleep = dependencies.sleep ?? defaultSleep
  const uploaded: UploadedReplicateInput[] = []

  try {
    const videoInput = await withReplicateRetries(
      () => uploadReplicateInput(request.sourceVideoPath, videoContentType(request.sourceVideoPath)),
      sleep,
    )
    uploaded.push(videoInput)
    const audioInput = await withReplicateRetries(
      () => uploadReplicateInput(request.audioPath, audioContentType(request.audioPath)),
      sleep,
    )
    uploaded.push(audioInput)

    const execution = await withReplicateRetries(
      () => executeReplicatePrediction({
        videoId: request.videoId,
        videoAssetId: request.videoAssetId,
        model,
        input: mapMediaInput(model, {
          videoUrl: videoInput.url,
          audioUrl: audioInput.url,
        }),
        webhookUrl: config.webhookUrl,
        idempotencyKey,
        attemptScope,
        attemptCeilingScope,
      }),
      sleep,
    )
    await materializeOutput(execution.persistedStorageKey, request.outputPath)

    return {
      localPath: request.outputPath,
      provider: "replicate",
      modelId: model.id,
      predictionId: execution.predictionId,
      costUsd: estimateMediaCost(model, request.durationSec),
      idempotencyKey,
    }
  } catch (error) {
    if (error instanceof MediaProviderRetriesExhaustedError && config.fallbackProvider === "fal") {
      return runFal(request)
    }
    throw error
  } finally {
    await Promise.allSettled(
      uploaded
        .map(file => file.id)
        .filter((id): id is string => Boolean(id))
        .map(id => deleteReplicateInput(id)),
    )
  }
}

async function executePrediction(
  submission: PredictionSubmission,
  config: ReplicateConfig,
  outputDurationSec?: number | null,
): Promise<ReplicatePredictionExecution> {
  const provider = config.mockMode
    ? createMockReplicateProvider({ outputDurationSec })
    : createReplicateProvider({ config })
  const service = createPredictionService({ provider })
  let prediction = await service.submitOrResumePrediction(submission)
  if (!prediction.persistedStorageKey) {
    prediction = await service.waitForPrediction(prediction.id, {
      pollIntervalMs: config.mockMode ? 0 : 5_000,
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

export async function withReplicateRetries<T>(
  operation: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; attempt <= REPLICATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof MediaProviderRetriesExhaustedError) throw error
      if (!(error instanceof ReplicateProviderError) || !error.retryable) throw error
      if (attempt === REPLICATE_MAX_ATTEMPTS) {
        throw new MediaProviderRetriesExhaustedError("replicate", attempt, error)
      }
      // Назначенная провайдером пауза точнее нашей догадки: ждать меньше —
      // значит гарантированно получить тот же отказ второй раз.
      const backoffMs = REPLICATE_RETRY_DELAY_MS * attempt
      const requestedMs = error.retryAfterSec !== null
        ? Math.ceil(error.retryAfterSec * 1000) + 1_000
        : 0
      await sleep(Math.max(backoffMs, requestedMs))
    }
  }
  throw new Error("Unreachable Replicate retry state")
}

interface FalLipSyncResponse {
  video?: { url?: string }
}

async function executeFalLipSync(request: LipSyncRequest): Promise<LipSyncResult> {
  const spec = falLipSyncSpec()
  const [videoUrl, audioUrl] = await Promise.all([
    falUploadFile(request.sourceVideoPath, videoContentType(request.sourceVideoPath)),
    falUploadFile(request.audioPath, audioContentType(request.audioPath)),
  ])
  const submitted = await falSubmit(spec.id, mapMediaInput(spec, { videoUrl, audioUrl }))
  const result = await falPollUntilDone<FalLipSyncResponse>(
    spec.id,
    submitted.requestId,
  )
  const outputUrl = result.data?.video?.url
  if (!outputUrl) throw new Error("fal lip-sync completed without an output URL")
  await downloadFile(outputUrl, request.outputPath)
  return {
    localPath: request.outputPath,
    provider: "fal",
    modelId: spec.id,
    predictionId: submitted.requestId,
    costUsd: estimateMediaCost(spec, { outputSeconds: request.durationSec }),
  }
}

function assertSupportedDuration(durationSec: number, min: number, max: number): void {
  if (!Number.isFinite(durationSec) || durationSec < min || durationSec > max) {
    throw new Error(`Replicate Kling lip-sync requires a ${min}-${max} second source clip`)
  }
}

function videoContentType(path: string): string {
  return extname(path).toLowerCase() === ".mov" ? "video/quicktime" : "video/mp4"
}

function audioContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".wav": return "audio/wav"
    case ".m4a": return "audio/mp4"
    case ".aac": return "audio/aac"
    default: return "audio/mpeg"
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(path)
    stream.on("error", reject)
    stream.on("data", chunk => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
