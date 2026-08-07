import { describe, expect, it, vi } from "vitest"
import { createMediaPredictionRepository } from "../../../server/utils/replicate/prediction-repository"

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pred_internal_1",
    externalId: null,
    idempotencyKey: "video:1:scene:2",
    status: "starting",
    inputSnapshot: {},
    outputSnapshot: null,
    outputUrl: null,
    errorMessage: null,
    terminalAt: null,
    webhookReceivedAt: null,
    ...overrides,
  }
}

describe("media prediction repository", () => {
  it("creates or reads by idempotency key with a sanitized snapshot", async () => {
    const row = makeRow()
    const upsert = vi.fn(async () => row)
    const client = {
      mediaPrediction: { upsert },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(client),
    }
    const repository = createMediaPredictionRepository(client)

    const result = await repository.createOrRead({
      videoId: 1,
      videoAssetId: 2,
      provider: "replicate",
      capability: "lip_sync",
      model: "kwaivgi/kling-lip-sync",
      idempotencyKey: "video:1:scene:2",
      inputSnapshot: {
        video_url: "https://cdn.example.com/video.mp4",
        apiToken: "must-not-persist",
      },
    })

    expect(result).toBe(row)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { idempotencyKey: "video:1:scene:2" },
      update: {},
      create: expect.objectContaining({
        inputSnapshot: {
          video_url: "https://cdn.example.com/video.mp4",
          apiToken: "[REDACTED]",
        },
      }),
    }))
  })

  it("does not regress a terminal row on a late processing event", async () => {
    const row = makeRow({ status: "succeeded", terminalAt: new Date() })
    const updateMany = vi.fn()
    const client = {
      mediaPrediction: {
        findUnique: vi.fn(async () => row),
        updateMany,
        update: vi.fn(),
      },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(client),
    }
    const repository = createMediaPredictionRepository(client)

    const result = await repository.applyStatusUpdate("external_1", "processing", {
      webhookReceivedAt: new Date(),
    })

    expect(result).toBe(row)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("updates a non-terminal row with a compare-and-set status guard", async () => {
    const current = makeRow({ externalId: "external_1", status: "processing" })
    const updated = makeRow({
      externalId: "external_1",
      status: "succeeded",
      outputUrl: "https://replicate.delivery/output.mp4",
      terminalAt: new Date(),
    })
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const findUnique = vi.fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(updated)
    const client = {
      mediaPrediction: {
        findUnique,
        updateMany,
      },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(client),
    }
    const repository = createMediaPredictionRepository(client)

    const result = await repository.applyStatusUpdate("external_1", "succeeded", {
      outputUrl: "https://replicate.delivery/output.mp4",
      outputSnapshot: { authorization: "must-not-persist", ok: true },
    })

    expect(result).toBe(updated)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: current.id, status: "processing" },
      data: expect.objectContaining({
        status: "succeeded",
        outputSnapshot: { authorization: "[REDACTED]", ok: true },
        terminalAt: expect.any(Date),
      }),
    }))
  })

  it("claims output persistence with one atomic compare-and-set", async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    const client = {
      mediaPrediction: { updateMany },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(client),
    }
    const repository = createMediaPredictionRepository(client)

    await expect(repository.claimPersistence("internal_1")).resolves.toBe(true)
    await expect(repository.claimPersistence("internal_1")).resolves.toBe(false)
    // Вторая ветка OR — зависшая заявка: процесс мог умереть посреди заливки,
    // и сбросить `persisting` обратно некому. Без неё запись выбиралась
    // восстановлением раз в минуту, но не захватывалась никогда.
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "internal_1",
        status: "succeeded",
        persistedStorageKey: null,
        OR: [
          { persistenceStatus: { in: ["pending", "failed"] } },
          { persistenceStatus: "persisting", persistenceStartedAt: { lte: expect.any(Date) } },
        ],
      },
      data: expect.objectContaining({
        persistenceStatus: "persisting",
        persistenceStartedAt: expect.any(Date),
        persistenceError: null,
      }),
    })
  })

  it("records persistent storage metadata after upload", async () => {
    const persisted = makeRow({
      status: "succeeded",
      persistedStorageKey: "contentfactory/media-predictions/internal_1/output.mp4",
      persistenceStatus: "persisted",
    })
    const update = vi.fn(async () => persisted)
    const client = {
      mediaPrediction: { update },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(client),
    }
    const repository = createMediaPredictionRepository(client)

    const result = await repository.markOutputPersisted("internal_1", {
      storageKey: "contentfactory/media-predictions/internal_1/output.mp4",
      storageProvider: "gcs",
      fileSizeBytes: 100n,
      fileSha256: "sha256",
      contentType: "video/mp4",
    })

    expect(result).toBe(persisted)
    expect(update).toHaveBeenCalledWith({
      where: { id: "internal_1" },
      data: expect.objectContaining({
        persistenceStatus: "persisted",
        persistedStorageKey: "contentfactory/media-predictions/internal_1/output.mp4",
        persistedStorageProvider: "gcs",
        persistedFileSizeBytes: 100n,
      }),
    })
  })
})
