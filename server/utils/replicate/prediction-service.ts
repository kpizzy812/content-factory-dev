import { mkdir, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import type {
  CreateMediaPredictionInput,
  MediaProvider,
  MediaPredictionStatus,
  NormalizedMediaPrediction,
} from "../media-provider/types"
import type { AssetStorageColumns } from "../storage/persist-asset"
import {
  createMediaPredictionRepository,
  type CreateMediaPredictionRecord,
  type MediaPredictionRecord,
  type PredictionStatusPatch,
} from "./prediction-repository"

export interface PredictionServiceRepository {
  createOrRead(input: CreateMediaPredictionRecord): Promise<MediaPredictionRecord>
  findById(id: string): Promise<MediaPredictionRecord | null>
  attachExternalId(id: string, externalId: string, status: MediaPredictionStatus): Promise<MediaPredictionRecord>
  applyStatusUpdate(
    externalId: string,
    status: MediaPredictionStatus,
    patch: PredictionStatusPatch,
  ): Promise<MediaPredictionRecord>
  claimPersistence(id: string): Promise<boolean>
  markOutputPersisted(id: string, asset: AssetStorageColumns): Promise<MediaPredictionRecord>
  markPersistenceFailed(id: string, error: string): Promise<MediaPredictionRecord>
  findRecoverable(limit: number): Promise<MediaPredictionRecord[]>
}

export interface PredictionSubmission extends CreateMediaPredictionInput {
  videoId?: number | null
  videoAssetId?: number | null
}

export interface WaitForPredictionOptions {
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface PredictionRecoveryResult {
  inspected: number
  recovered: number
  failed: number
}

export interface CreatePredictionServiceOptions {
  repository?: PredictionServiceRepository
  provider: MediaProvider
  persistOutput?: (
    prediction: MediaPredictionRecord,
    outputUrl: string,
  ) => Promise<AssetStorageColumns>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export function createPredictionService({
  repository = createMediaPredictionRepository() as unknown as PredictionServiceRepository,
  provider,
  persistOutput = persistPredictionOutput,
  sleep = defaultSleep,
  now = Date.now,
}: CreatePredictionServiceOptions) {
  async function applyProviderPrediction(
    prediction: NormalizedMediaPrediction,
  ): Promise<MediaPredictionRecord> {
    return repository.applyStatusUpdate(prediction.externalId, prediction.status, {
      outputSnapshot: prediction.raw,
      outputUrl: prediction.outputUrl,
      errorMessage: prediction.error,
      startedAt: prediction.startedAt,
      completedAt: prediction.completedAt,
    })
  }

  async function finalizeSucceeded(
    prediction: MediaPredictionRecord,
  ): Promise<MediaPredictionRecord> {
    if (prediction.persistedStorageKey) return prediction
    if (prediction.status !== "succeeded") return prediction

    if (!prediction.outputUrl || typeof prediction.outputUrl !== "string") {
      const message = `Replicate output is missing or expired for prediction ${prediction.id}`
      await repository.markPersistenceFailed(prediction.id, message)
      throw new Error(message)
    }

    const claimed = await repository.claimPersistence(prediction.id)
    if (!claimed) {
      return await requirePrediction(prediction.id)
    }

    try {
      const asset = await persistOutput(prediction, prediction.outputUrl)
      return await repository.markOutputPersisted(prediction.id, asset)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await repository.markPersistenceFailed(prediction.id, message)
      throw error
    }
  }

  async function requirePrediction(id: string): Promise<MediaPredictionRecord> {
    const prediction = await repository.findById(id)
    if (!prediction) throw new Error(`Media prediction not found: ${id}`)
    return prediction
  }

  async function submitOrResumePrediction(
    request: PredictionSubmission,
  ): Promise<MediaPredictionRecord> {
    let prediction = await repository.createOrRead({
      videoId: request.videoId,
      videoAssetId: request.videoAssetId,
      provider: provider.name,
      capability: request.model.capability,
      model: request.model.id,
      idempotencyKey: request.idempotencyKey,
      inputSnapshot: request.input,
    })

    if (!prediction.externalId) {
      const submitted = await provider.create(request)
      prediction = await repository.attachExternalId(
        prediction.id,
        submitted.externalId,
        "starting",
      )
      prediction = await applyProviderPrediction(submitted)
    }

    return finalizeSucceeded(prediction)
  }

  async function waitForPrediction(
    id: string,
    options: WaitForPredictionOptions = {},
  ): Promise<MediaPredictionRecord> {
    const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000
    const pollIntervalMs = options.pollIntervalMs ?? 5_000
    const deadline = now() + timeoutMs

    while (true) {
      let prediction = await requirePrediction(id)
      if (prediction.persistedStorageKey) return prediction

      if (prediction.status === "failed" || prediction.status === "canceled") {
        throw new Error(
          prediction.errorMessage
            ? `Replicate prediction ${prediction.status}: ${prediction.errorMessage}`
            : `Replicate prediction ${prediction.status}: ${prediction.id}`,
        )
      }

      if (prediction.status === "succeeded") {
        prediction = await finalizeSucceeded(prediction)
        if (prediction.persistedStorageKey) return prediction
      } else {
        if (!prediction.externalId) {
          throw new Error(`Media prediction ${prediction.id} has not been submitted to Replicate`)
        }
        const remote = await provider.get(prediction.externalId)
        prediction = await applyProviderPrediction(remote)
        prediction = await finalizeSucceeded(prediction)
        if (prediction.persistedStorageKey) return prediction
      }

      if (now() >= deadline) {
        throw new Error(`Timed out waiting for media prediction ${id}`)
      }
      await sleep(pollIntervalMs)
    }
  }

  async function recoverStalePredictions(limit = 20): Promise<PredictionRecoveryResult> {
    const predictions = await repository.findRecoverable(limit)
    let recovered = 0
    let failed = 0

    for (const prediction of predictions) {
      try {
        let current = prediction
        if (current.status !== "succeeded") {
          if (!current.externalId) throw new Error(`Prediction ${current.id} has no external id`)
          current = await applyProviderPrediction(await provider.get(current.externalId))
        }
        current = await finalizeSucceeded(current)
        if (current.persistedStorageKey || current.status === "failed" || current.status === "canceled") {
          recovered += 1
        }
      } catch {
        failed += 1
      }
    }

    return { inspected: predictions.length, recovered, failed }
  }

  return {
    submitOrResumePrediction,
    waitForPrediction,
    recoverStalePredictions,
  }
}

async function persistPredictionOutput(
  prediction: MediaPredictionRecord,
  outputUrl: string,
): Promise<AssetStorageColumns> {
  const [{ downloadFile }, { StorageKeys }, { uploadLocalAsset }] = await Promise.all([
    import("../video-helpers"),
    import("../storage/keys"),
    import("../storage/persist-asset"),
  ])
  const extension = inferExtension(outputUrl)
  const directory = join(tmpdir(), "contentfactory-replicate")
  const localPath = join(directory, `${prediction.id}.${extension}`)
  await mkdir(directory, { recursive: true })

  try {
    await downloadFile(outputUrl, localPath)
    return await uploadLocalAsset(
      localPath,
      StorageKeys.mediaPredictionOutput(prediction.id, extension),
      extension === "mp4" ? "video/mp4" : undefined,
    )
  } finally {
    await unlink(localPath).catch(() => {})
  }
}

function inferExtension(outputUrl: string): string {
  try {
    const extension = extname(new URL(outputUrl).pathname).replace(/^\./, "").toLowerCase()
    return extension || "mp4"
  } catch {
    return "mp4"
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
