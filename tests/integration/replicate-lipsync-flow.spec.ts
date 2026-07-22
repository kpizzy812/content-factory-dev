import { describe, expect, it, vi } from "vitest"
import { resolveMediaModel } from "../../server/utils/media-provider/registry"
import { createMockReplicateProvider } from "../../server/utils/replicate/mock"
import { createPredictionService } from "../../server/utils/replicate/prediction-service"
import { handleReplicateWebhook } from "../../server/utils/replicate/webhook"

describe("Replicate lip-sync durable flow", () => {
  it("accepts a duplicate webhook, persists once, and resumes without a second submission", async () => {
    const baseProvider = createMockReplicateProvider({ completeAfterPolls: 100 })
    const create = vi.fn(baseProvider.create)
    const provider = { ...baseProvider, create }
    const persistOutput = vi.fn(async () => ({
      storageKey: "zavodcamp/media-predictions/integration/output.mp4",
      storageProvider: "mock",
      fileSizeBytes: 256n,
      fileSha256: "integration-sha256",
      contentType: "video/mp4",
    }))
    const service = createPredictionService({ provider, persistOutput })
    const request = {
      model: resolveMediaModel("lip_sync"),
      input: {
        video_url: "https://files.example/source.mp4",
        audio_file: "https://files.example/speech.mp3",
      },
      webhookUrl: "https://factory.example.com/api/webhooks/replicate",
      idempotencyKey: `integration:replicate:${Date.now()}`,
    }

    const submitted = await service.submitOrResumePrediction(request)
    expect(submitted.externalId).toBeTruthy()
    expect(create).toHaveBeenCalledTimes(1)

    const webhookBody = JSON.stringify({
      id: submitted.externalId,
      model: request.model.id,
      status: "succeeded",
      output: "https://replicate.delivery/integration-output.mp4",
      completed_at: "2026-07-22T08:00:00.000Z",
    })
    const webhookInput = {
      body: webhookBody,
      headers: {},
      url: request.webhookUrl,
      secret: "integration-secret",
      validator: async () => true,
    }

    await handleReplicateWebhook(webhookInput)
    await handleReplicateWebhook(webhookInput)

    const completed = await service.waitForPrediction(submitted.id, { pollIntervalMs: 0 })
    const resumed = await service.submitOrResumePrediction(request)

    expect(completed.persistedStorageKey).toBe(
      "zavodcamp/media-predictions/integration/output.mp4",
    )
    expect(resumed.id).toBe(completed.id)
    expect(resumed.persistedStorageKey).toBe(completed.persistedStorageKey)
    expect(create).toHaveBeenCalledTimes(1)
    expect(persistOutput).toHaveBeenCalledTimes(1)
  })
})
