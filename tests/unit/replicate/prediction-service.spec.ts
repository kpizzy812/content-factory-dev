import { describe, expect, it, vi } from "vitest"
import { resolveMediaModel } from "../../../server/utils/media-provider/registry"
import { createPredictionService } from "../../../server/utils/replicate/prediction-service"

function createHarness() {
  let row: Record<string, any> | null = null
  let persistenceClaimed = false
  const repository = {
    createOrRead: vi.fn(async (input: Record<string, unknown>) => {
      row ??= {
        id: "internal_1",
        externalId: null,
        idempotencyKey: input.idempotencyKey,
        provider: input.provider,
        capability: input.capability,
        model: input.model,
        status: "starting",
        outputUrl: null,
        persistedStorageKey: null,
        persistenceStatus: "pending",
      }
      return row
    }),
    findById: vi.fn(async () => row),
    attachExternalId: vi.fn(async (_id: string, externalId: string) => {
      row = { ...row, externalId, status: "starting" }
      return row
    }),
    applyStatusUpdate: vi.fn(async (_externalId: string, status: string, patch: Record<string, unknown>) => {
      row = { ...row, ...patch, status }
      return row
    }),
    claimPersistence: vi.fn(async () => {
      if (persistenceClaimed || row?.persistedStorageKey) return false
      persistenceClaimed = true
      row = { ...row, persistenceStatus: "persisting" }
      return true
    }),
    markOutputPersisted: vi.fn(async (_id: string, asset: Record<string, unknown>) => {
      row = {
        ...row,
        persistenceStatus: "persisted",
        persistedStorageKey: asset.storageKey,
        persistedStorageProvider: asset.storageProvider,
      }
      return row
    }),
    markPersistenceFailed: vi.fn(async (_id: string, error: string) => {
      persistenceClaimed = false
      row = { ...row, persistenceStatus: "failed", persistenceError: error }
      return row
    }),
    findRecoverable: vi.fn(async () => row ? [row] : []),
  }
  return {
    repository,
    getRow: () => row,
    setRow: (next: Record<string, any>) => { row = next },
  }
}

const request = {
  model: resolveMediaModel("lip_sync"),
  input: { video_url: "https://cdn.example.com/video.mp4", audio_file: "https://cdn.example.com/audio.mp3" },
  webhookUrl: "https://factory.example.com/api/webhooks/replicate",
  idempotencyKey: "video:1:scene:1",
  videoId: 1,
  videoAssetId: 2,
}

describe("Replicate prediction service", () => {
  it("submits one paid job for repeated calls with the same idempotency key", async () => {
    const harness = createHarness()
    const create = vi.fn(async () => ({
      externalId: "external_1",
      provider: "replicate" as const,
      model: request.model.id,
      status: "processing" as const,
      outputUrl: null,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      raw: {},
    }))
    const provider = { name: "replicate" as const, create, get: vi.fn(), cancel: vi.fn() }
    const service = createPredictionService({
      repository: harness.repository,
      provider,
      persistOutput: vi.fn(),
      sleep: vi.fn(),
    })

    await service.submitOrResumePrediction(request)
    await service.submitOrResumePrediction(request)

    expect(create).toHaveBeenCalledTimes(1)
    expect(harness.getRow()?.externalId).toBe("external_1")
  })

  it("recovers a missed webhook, persists output once, and resumes from storage", async () => {
    const harness = createHarness()
    harness.setRow({
      id: "internal_1",
      externalId: "external_1",
      idempotencyKey: request.idempotencyKey,
      provider: "replicate",
      capability: "lip_sync",
      model: request.model.id,
      status: "processing",
      outputUrl: null,
      persistedStorageKey: null,
      persistenceStatus: "pending",
    })
    const get = vi.fn(async () => ({
      externalId: "external_1",
      provider: "replicate" as const,
      model: request.model.id,
      status: "succeeded" as const,
      outputUrl: "https://replicate.delivery/output.mp4",
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      raw: {},
    }))
    const persistOutput = vi.fn(async () => ({
      storageKey: "contentfactory/media-predictions/internal_1/output.mp4",
      storageProvider: "mock",
      fileSizeBytes: 100n,
      fileSha256: "sha256",
      contentType: "video/mp4",
    }))
    const provider = { name: "replicate" as const, create: vi.fn(), get, cancel: vi.fn() }
    const service = createPredictionService({
      repository: harness.repository,
      provider,
      persistOutput,
      sleep: vi.fn(),
    })

    const recovered = await service.recoverStalePredictions(10)
    const resumed = await service.waitForPrediction("internal_1", { timeoutMs: 100 })

    expect(recovered).toEqual({ inspected: 1, recovered: 1, failed: 0 })
    expect(resumed.persistedStorageKey).toContain("output.mp4")
    expect(get).toHaveBeenCalledTimes(1)
    expect(persistOutput).toHaveBeenCalledTimes(1)
  })

  it("fails clearly when a successful provider job has no remaining output", async () => {
    const harness = createHarness()
    harness.setRow({
      id: "internal_1",
      externalId: "external_1",
      idempotencyKey: request.idempotencyKey,
      provider: "replicate",
      capability: "lip_sync",
      model: request.model.id,
      status: "succeeded",
      outputUrl: null,
      persistedStorageKey: null,
      persistenceStatus: "pending",
    })
    const service = createPredictionService({
      repository: harness.repository,
      provider: { name: "replicate", create: vi.fn(), get: vi.fn(), cancel: vi.fn() },
      persistOutput: vi.fn(),
      sleep: vi.fn(),
    })

    await expect(service.waitForPrediction("internal_1", { timeoutMs: 100 }))
      .rejects.toThrow("output is missing or expired")
    expect(harness.repository.markPersistenceFailed).toHaveBeenCalledOnce()
  })
})
