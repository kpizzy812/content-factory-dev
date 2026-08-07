/**
 * Отмена медиа-задач Replicate по конкретному ролику.
 *
 * `cancelVideoPipeline` гасил только fal-запросы: у шагов есть `falRequestId`,
 * и по нему вызывается `falCancel`. Lip-sync живёт в `MediaPrediction` и до
 * этого места не доходил — оператор нажимал «отменить», а на Replicate задача
 * продолжала считаться и списывать деньги.
 */

import type { MediaPredictionStatus, MediaProvider } from "../media-provider/types"
import { createReplicateProvider } from "./client"
import { readReplicateConfig } from "./config"
import { createMockReplicateProvider } from "./mock"
import {
  createMediaPredictionRepository,
  type MediaPredictionRecord,
  type PredictionStatusPatch,
} from "./prediction-repository"
import { isTerminalPredictionStatus } from "./prediction-state"

export interface ReplicateCancellationResult {
  /** Сколько записей реально переведено в canceled. */
  canceled: number
  /** Сколько не удалось отменить (ошибка провайдера или гонка статусов). */
  failed: number
}

export interface ReplicateCancellationRepository {
  findActiveByVideoId(videoId: number): Promise<MediaPredictionRecord[]>
  applyStatusUpdate(
    externalId: string,
    status: MediaPredictionStatus,
    patch: PredictionStatusPatch,
  ): Promise<MediaPredictionRecord>
}

export interface ReplicateCancellationDeps {
  repository: ReplicateCancellationRepository
  provider: MediaProvider
  log?: (message: string) => void
}

/**
 * Ядро отмены с внедрёнными зависимостями — чтобы логику можно было проверить
 * без БД и сети. Ошибка одной записи не отменяет остальные: у ролика может быть
 * несколько сцен, и застрявшая первая не должна оставлять оплаченными все.
 */
export async function runReplicateCancellation(
  videoId: number,
  { repository, provider, log = defaultLog }: ReplicateCancellationDeps,
): Promise<ReplicateCancellationResult> {
  const active = await repository.findActiveByVideoId(videoId)
  let canceled = 0
  let failed = 0

  for (const prediction of active) {
    const externalId = prediction.externalId
    if (!externalId) continue

    try {
      const remote = await provider.cancel(externalId)
      // Провайдер мог успеть завершить задачу до отмены — навязывать canceled
      // поверх succeeded нельзя, репозиторий такой переход и не пропустит.
      const status = isTerminalPredictionStatus(remote.status) ? remote.status : "canceled"
      const updated = await repository.applyStatusUpdate(externalId, status, {
        outputSnapshot: remote.raw,
        outputUrl: remote.outputUrl,
        errorMessage: remote.error,
        completedAt: remote.completedAt,
      })

      if (updated.status === "canceled") {
        canceled += 1
      }
      else {
        log(`prediction ${externalId} успел завершиться со статусом ${updated.status}`)
      }
    }
    catch (error) {
      failed += 1
      log(`не удалось отменить prediction ${externalId}: ${describe(error)}`)
    }
  }

  return { canceled, failed }
}

/**
 * Отменяет все живые lip-sync задачи ролика. Никогда не бросает наружу:
 * вызывается из пути отмены пайплайна, где падение оставило бы ролик
 * в подвешенном состоянии.
 */
export async function cancelReplicatePredictionsForVideo(
  videoId: number,
): Promise<{ canceled: number; failed: number }> {
  const empty = { canceled: 0, failed: 0 }

  let provider: MediaProvider
  try {
    const config = readReplicateConfig()
    provider = config.mockMode
      ? createMockReplicateProvider()
      : createReplicateProvider({ config })
  }
  catch (error) {
    defaultLog(`отмена пропущена: конфигурация Replicate неполна — ${describe(error)}`)
    return empty
  }

  try {
    return await runReplicateCancellation(videoId, {
      repository: createMediaPredictionRepository(),
      provider,
    })
  }
  catch (error) {
    defaultLog(`отмена задач ролика ${videoId} не выполнена: ${describe(error)}`)
    return empty
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function defaultLog(message: string): void {
  console.warn(`[replicate-cancel] ${message}`)
}
