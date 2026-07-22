import { validateWebhook } from "replicate"
import type { MediaPredictionStatus } from "../media-provider/types"
import { normalizeReplicatePrediction } from "./client"
import {
  createMediaPredictionRepository,
  type MediaPredictionRecord,
  type PredictionStatusPatch,
} from "./prediction-repository"

export class InvalidReplicateWebhookError extends Error {
  constructor() {
    super("Invalid Replicate webhook signature")
    this.name = "InvalidReplicateWebhookError"
  }
}

export class InvalidReplicateWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidReplicateWebhookPayloadError"
  }
}

export type ReplicateWebhookValidator = (
  request: Request,
  secret: string,
) => Promise<boolean>

export interface ReplicateWebhookRepository {
  applyStatusUpdate(
    externalId: string,
    status: MediaPredictionStatus,
    patch: PredictionStatusPatch,
  ): Promise<MediaPredictionRecord>
}

export interface HandleReplicateWebhookInput {
  body: string
  headers: HeadersInit
  url: string
  secret: string
  repository?: ReplicateWebhookRepository
  validator?: ReplicateWebhookValidator
  receivedAt?: Date
}

export async function handleReplicateWebhook({
  body,
  headers,
  url,
  secret,
  repository = createMediaPredictionRepository(),
  validator = validateWebhook,
  receivedAt = new Date(),
}: HandleReplicateWebhookInput): Promise<MediaPredictionRecord> {
  const request = new Request(url, {
    method: "POST",
    headers,
    body,
  })

  let valid = false
  try {
    valid = await validator(request, secret)
  } catch {
    valid = false
  }
  if (!valid) throw new InvalidReplicateWebhookError()

  const raw = parsePayload(body)
  const prediction = normalizeReplicatePrediction(raw)
  const metrics = raw.metrics

  return repository.applyStatusUpdate(prediction.externalId, prediction.status, {
    outputSnapshot: prediction.raw,
    outputUrl: prediction.outputUrl,
    errorMessage: prediction.error,
    metrics,
    startedAt: prediction.startedAt,
    completedAt: prediction.completedAt,
    webhookReceivedAt: receivedAt,
  })
}

function parsePayload(body: string): Parameters<typeof normalizeReplicatePrediction>[0] {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    throw new InvalidReplicateWebhookPayloadError("Replicate webhook body is not valid JSON")
  }

  if (!raw || typeof raw !== "object") {
    throw new InvalidReplicateWebhookPayloadError("Replicate webhook body must be an object")
  }
  const record = raw as Record<string, unknown>
  if (typeof record.id !== "string" || typeof record.status !== "string") {
    throw new InvalidReplicateWebhookPayloadError("Replicate webhook is missing id or status")
  }
  return record as Parameters<typeof normalizeReplicatePrediction>[0]
}
