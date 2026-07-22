import { prisma } from "../prisma"
import type { MediaPredictionStatus, MediaProviderName } from "../media-provider/types"
import {
  isTerminalPredictionStatus,
  sanitizePredictionSnapshot,
  transitionPredictionStatus,
} from "./prediction-state"

export interface MediaPredictionRecord {
  id: string
  externalId: string | null
  idempotencyKey: string
  status: string
  inputSnapshot: unknown
  outputSnapshot: unknown
  outputUrl: string | null
  errorMessage: string | null
  terminalAt: Date | null
  webhookReceivedAt: Date | null
  [key: string]: unknown
}

interface MediaPredictionDelegate {
  upsert(args: Record<string, unknown>): Promise<MediaPredictionRecord>
  findUnique(args: Record<string, unknown>): Promise<MediaPredictionRecord | null>
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>
}

export interface MediaPredictionDbClient {
  mediaPrediction: MediaPredictionDelegate
  $transaction<T>(
    operation: (tx: MediaPredictionDbClient) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>
}

export interface CreateMediaPredictionRecord {
  videoId?: number | null
  videoAssetId?: number | null
  provider: MediaProviderName
  capability: string
  model: string
  idempotencyKey: string
  inputSnapshot: unknown
}

export interface PredictionStatusPatch {
  outputSnapshot?: unknown
  outputUrl?: string | null
  errorMessage?: string | null
  metrics?: unknown
  startedAt?: Date | null
  completedAt?: Date | null
  terminalAt?: Date | null
  webhookReceivedAt?: Date | null
}

export function createMediaPredictionRepository(
  client: MediaPredictionDbClient = prisma as unknown as MediaPredictionDbClient,
) {
  return {
    createOrRead(input: CreateMediaPredictionRecord): Promise<MediaPredictionRecord> {
      return client.mediaPrediction.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: {},
        create: {
          videoId: input.videoId ?? null,
          videoAssetId: input.videoAssetId ?? null,
          provider: input.provider,
          capability: input.capability,
          model: input.model,
          idempotencyKey: input.idempotencyKey,
          status: "starting",
          inputSnapshot: sanitizePredictionSnapshot(input.inputSnapshot),
        },
      })
    },

    findByIdempotencyKey(idempotencyKey: string): Promise<MediaPredictionRecord | null> {
      return client.mediaPrediction.findUnique({ where: { idempotencyKey } })
    },

    findByExternalId(externalId: string): Promise<MediaPredictionRecord | null> {
      return client.mediaPrediction.findUnique({ where: { externalId } })
    },

    async attachExternalId(
      id: string,
      externalId: string,
      status: MediaPredictionStatus,
    ): Promise<MediaPredictionRecord> {
      return client.$transaction(async (tx) => {
        const current = await tx.mediaPrediction.findUnique({ where: { id } })
        if (!current) throw new Error(`Media prediction not found: ${id}`)
        if (current.externalId === externalId) return current
        if (current.externalId) {
          throw new Error(`Media prediction ${id} is already attached to ${current.externalId}`)
        }

        const updated = await tx.mediaPrediction.updateMany({
          where: { id, externalId: null },
          data: {
            externalId,
            status,
            submittedAt: new Date(),
          },
        })
        if (updated.count !== 1) {
          throw new Error(`Concurrent external id attachment for media prediction ${id}`)
        }

        const result = await tx.mediaPrediction.findUnique({ where: { id } })
        if (!result) throw new Error(`Media prediction disappeared after update: ${id}`)
        return result
      }, { isolationLevel: "Serializable" })
    },

    async applyStatusUpdate(
      externalId: string,
      nextStatus: MediaPredictionStatus,
      patch: PredictionStatusPatch = {},
    ): Promise<MediaPredictionRecord> {
      return client.$transaction(async (tx) => {
        const current = await tx.mediaPrediction.findUnique({ where: { externalId } })
        if (!current) throw new Error(`Media prediction not found for provider id: ${externalId}`)

        const currentStatus = current.status as MediaPredictionStatus
        if (isTerminalPredictionStatus(currentStatus)) {
          return current
        }

        const transition = transitionPredictionStatus(currentStatus, nextStatus)
        if (!transition.changed) return current

        const now = new Date()
        const data: Record<string, unknown> = {
          status: transition.status,
          ...copyDefinedPatch(patch),
        }
        if (patch.outputSnapshot !== undefined) {
          data.outputSnapshot = sanitizePredictionSnapshot(patch.outputSnapshot)
        }
        if (patch.metrics !== undefined) {
          data.metrics = sanitizePredictionSnapshot(patch.metrics)
        }
        if (transition.terminal) {
          data.terminalAt = patch.terminalAt ?? now
          data.completedAt = patch.completedAt ?? now
        }

        const updated = await tx.mediaPrediction.updateMany({
          where: { id: current.id, status: current.status },
          data,
        })
        if (updated.count !== 1) {
          throw new Error(`Concurrent status update for media prediction ${current.id}`)
        }

        const result = await tx.mediaPrediction.findUnique({ where: { id: current.id } })
        if (!result) throw new Error(`Media prediction disappeared after update: ${current.id}`)
        return result
      }, { isolationLevel: "Serializable" })
    },
  }
}

function copyDefinedPatch(patch: PredictionStatusPatch): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && key !== "outputSnapshot" && key !== "metrics") {
      copy[key] = value
    }
  }
  return copy
}
