import { createHash } from "node:crypto"
import type {
  CreateMediaPredictionInput,
  MediaProvider,
  NormalizedMediaPrediction,
} from "../media-provider/types"

export interface MockReplicateProviderOptions {
  completeAfterPolls?: number
  outputUrl?: string
}

interface MockState {
  polls: number
  prediction: NormalizedMediaPrediction
}

export function createMockReplicateProvider(
  options: MockReplicateProviderOptions = {},
): MediaProvider {
  const completeAfterPolls = options.completeAfterPolls ?? 1
  // mock://video/... — заглушка собирается ffmpeg'ом в настоящий mp4. Схема
  // mock://replicate/... дала бы JSON с расширением .mp4, на котором падает сборка.
  const outputUrl = options.outputUrl ?? "mock://video/output.mp4"
  const predictions = new Map<string, MockState>()

  return {
    name: "replicate",

    async create(request: CreateMediaPredictionInput): Promise<NormalizedMediaPrediction> {
      const externalId = stablePredictionId(request.idempotencyKey)
      const existing = predictions.get(externalId)
      if (existing) return existing.prediction

      const prediction: NormalizedMediaPrediction = {
        externalId,
        provider: "replicate",
        model: request.model.id,
        status: "processing",
        outputUrl: null,
        error: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: null,
        raw: {
          mock: true,
          idempotencyKey: request.idempotencyKey,
        },
      }
      predictions.set(externalId, { polls: 0, prediction })
      return prediction
    },

    async get(externalId: string): Promise<NormalizedMediaPrediction> {
      const state = requireState(predictions, externalId)
      state.polls += 1
      if (state.prediction.status === "processing" && state.polls >= completeAfterPolls) {
        state.prediction = {
          ...state.prediction,
          status: "succeeded",
          outputUrl,
          completedAt: new Date("2026-01-01T00:00:05.000Z"),
          raw: { ...state.prediction.raw, polls: state.polls },
        }
      }
      return state.prediction
    },

    async cancel(externalId: string): Promise<NormalizedMediaPrediction> {
      const state = requireState(predictions, externalId)
      if (state.prediction.status === "processing" || state.prediction.status === "starting") {
        state.prediction = {
          ...state.prediction,
          status: "canceled",
          completedAt: new Date("2026-01-01T00:00:01.000Z"),
        }
      }
      return state.prediction
    },
  }
}

function stablePredictionId(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)
  return `mock_${digest}`
}

function requireState(
  predictions: Map<string, MockState>,
  externalId: string,
): MockState {
  const state = predictions.get(externalId)
  if (!state) throw new Error(`Mock Replicate prediction not found: ${externalId}`)
  return state
}
