import Replicate from "replicate"
import type {
  CreateMediaPredictionInput,
  MediaProvider,
  MediaPredictionStatus,
  NormalizedMediaPrediction,
} from "../media-provider/types"
import type { ReplicateConfig } from "./config"
import { sanitizePredictionSnapshot } from "./prediction-state"

interface RawReplicatePrediction {
  id: string
  status: string
  model?: string
  output?: unknown
  error?: unknown
  created_at?: string
  started_at?: string
  completed_at?: string
  [key: string]: unknown
}

export interface ReplicateClientAdapter {
  predictions: {
    create(options: Record<string, unknown>): Promise<RawReplicatePrediction>
    get(id: string): Promise<RawReplicatePrediction>
    cancel(id: string): Promise<RawReplicatePrediction>
  }
}

export interface CreateReplicateProviderOptions {
  config: ReplicateConfig
  client?: ReplicateClientAdapter
}

export function createReplicateProvider({
  config,
  client = createOfficialClient(config),
}: CreateReplicateProviderOptions): MediaProvider {
  return {
    name: "replicate",

    async create(request: CreateMediaPredictionInput): Promise<NormalizedMediaPrediction> {
      const options: Record<string, unknown> = {
        model: request.model.id,
        input: request.input,
      }
      if (request.webhookUrl) {
        options.webhook = request.webhookUrl
        options.webhook_events_filter = ["completed"]
      }

      const prediction = await client.predictions.create(options)
      return normalizeReplicatePrediction(prediction, request.model.id)
    },

    async get(externalId: string): Promise<NormalizedMediaPrediction> {
      const prediction = await client.predictions.get(externalId)
      return normalizeReplicatePrediction(prediction)
    },

    async cancel(externalId: string): Promise<NormalizedMediaPrediction> {
      const prediction = await client.predictions.cancel(externalId)
      return normalizeReplicatePrediction(prediction)
    },
  }
}

export function normalizeReplicatePrediction(
  prediction: RawReplicatePrediction,
  fallbackModel = "unknown",
): NormalizedMediaPrediction {
  return {
    externalId: prediction.id,
    provider: "replicate",
    model: prediction.model ?? fallbackModel,
    status: normalizeStatus(prediction.status),
    outputUrl: extractOutputUrl(prediction.output),
    error: normalizeError(prediction.error),
    createdAt: parseDate(prediction.created_at),
    startedAt: parseDate(prediction.started_at),
    completedAt: parseDate(prediction.completed_at),
    raw: sanitizePredictionSnapshot(prediction) as Record<string, unknown>,
  }
}

function createOfficialClient(config: ReplicateConfig): ReplicateClientAdapter {
  if (!config.apiToken) {
    throw new Error("REPLICATE_API_TOKEN is required to create the official Replicate client")
  }
  return new Replicate({
    auth: config.apiToken,
    useFileOutput: false,
  }) as unknown as ReplicateClientAdapter
}

function normalizeStatus(status: string): MediaPredictionStatus {
  if (status === "starting" || status === "processing" || status === "succeeded"
    || status === "failed" || status === "canceled") {
    return status
  }
  if (status === "aborted") return "failed"
  throw new Error(`Unsupported Replicate prediction status: ${status}`)
}

function extractOutputUrl(output: unknown): string | null {
  if (typeof output === "string") return output
  if (Array.isArray(output)) {
    return output.find((value): value is string => typeof value === "string") ?? null
  }
  if (!output || typeof output !== "object") return null

  const record = output as Record<string, unknown>
  if (typeof record.url === "string") return record.url
  if (record.video && typeof record.video === "object") {
    const video = record.video as Record<string, unknown>
    if (typeof video.url === "string") return video.url
  }
  return null
}

function normalizeError(error: unknown): string | null {
  if (error === null || error === undefined) return null
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  return JSON.stringify(error)
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
