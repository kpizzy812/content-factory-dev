import { describe, expect, it, vi } from "vitest"
import { resolveMediaModel } from "../../../server/utils/media-provider/registry"
import {
  exhaustedAttemptsMessage,
  isPoisonedPredictionAttempt,
  MAX_PREDICTION_ATTEMPTS,
  planPredictionAttempt,
} from "../../../server/utils/replicate/attempt-key"
import { runReplicateCancellation } from "../../../server/utils/replicate/cancel"
import { finalizeAfterWebhook, needsWebhookFinalization } from "../../../server/utils/replicate/finalize"
import { createPredictionService } from "../../../server/utils/replicate/prediction-service"
import { transitionPredictionStatus } from "../../../server/utils/replicate/prediction-state"

const BASE_KEY = "lip-sync:v1:video:1:scene:1:source:aaa:audio:bbb:model:kwaivgi/kling-lip-sync"

function normalized(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "external_1",
    provider: "replicate" as const,
    model: resolveMediaModel("lip_sync").id,
    status: "processing" as const,
    outputUrl: null,
    error: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: null,
    raw: {},
    ...overrides,
  }
}

/** Хранилище записей по идемпотентному ключу — заменяет MediaPrediction. */
function createRepositoryStub(seed: Record<string, any>[] = []) {
  const rows = new Map<string, Record<string, any>>()
  for (const row of seed) rows.set(row.idempotencyKey, row)
  let sequence = rows.size

  return {
    rows,
    createOrRead: vi.fn(async (input: Record<string, any>) => {
      const existing = rows.get(input.idempotencyKey)
      if (existing) return existing
      sequence += 1
      const row = {
        id: `internal_${sequence}`,
        externalId: null,
        idempotencyKey: input.idempotencyKey,
        status: "starting",
        outputUrl: null,
        errorMessage: null,
        persistedStorageKey: null,
        persistenceStatus: "pending",
      }
      rows.set(row.idempotencyKey, row)
      return row
    }),
    findById: vi.fn(async (id: string) =>
      [...rows.values()].find(row => row.id === id) ?? null,
    ),
    attachExternalId: vi.fn(async (id: string, externalId: string) => {
      const row = [...rows.values()].find(item => item.id === id)!
      if ([...rows.values()].some(item => item.externalId === externalId)) {
        throw new Error(`Дубль externalId ${externalId}`)
      }
      row.externalId = externalId
      row.status = "starting"
      return row
    }),
    applyStatusUpdate: vi.fn(async (externalId: string, status: string, patch: Record<string, any>) => {
      const row = [...rows.values()].find(item => item.externalId === externalId)!
      Object.assign(row, patch, { status })
      return row
    }),
    claimPersistence: vi.fn(async (id: string) => {
      const row = [...rows.values()].find(item => item.id === id)!
      if (row.persistenceStatus === "persisting" || row.persistedStorageKey) return false
      row.persistenceStatus = "persisting"
      return true
    }),
    markOutputPersisted: vi.fn(async (id: string, asset: Record<string, any>) => {
      const row = [...rows.values()].find(item => item.id === id)!
      row.persistenceStatus = "persisted"
      row.persistedStorageKey = asset.storageKey
      return row
    }),
    markPersistenceFailed: vi.fn(async (id: string, error: string) => {
      const row = [...rows.values()].find(item => item.id === id)!
      row.persistenceStatus = "failed"
      row.persistenceError = error
      return row
    }),
    findRecoverable: vi.fn(async () => []),
  }
}

const submission = {
  model: resolveMediaModel("lip_sync"),
  input: { video_url: "https://cdn.example.com/v.mp4", audio_file: "https://cdn.example.com/a.mp3" },
  webhookUrl: "https://factory.example.com/api/webhooks/replicate",
  idempotencyKey: BASE_KEY,
  videoId: 1,
  videoAssetId: 2,
}

describe("Replicate: ключи попыток", () => {
  it("первая попытка сохраняет исходный ключ, следующие получают суффикс", () => {
    expect(planPredictionAttempt(BASE_KEY, 1)).toEqual({ key: BASE_KEY, attempt: 1, last: false })
    expect(planPredictionAttempt(BASE_KEY, 3)?.key).toBe(`${BASE_KEY}#retry-3`)
  })

  it("на последней попытке поднимает флаг, за потолком возвращает null", () => {
    expect(planPredictionAttempt(BASE_KEY, MAX_PREDICTION_ATTEMPTS)?.last).toBe(true)
    expect(planPredictionAttempt(BASE_KEY, MAX_PREDICTION_ATTEMPTS + 1)).toBeNull()
  })

  it("отравленной считает только терминальную запись без файла в хранилище", () => {
    expect(isPoisonedPredictionAttempt({ status: "failed", persistedStorageKey: null })).toBe(true)
    expect(isPoisonedPredictionAttempt({ status: "canceled", persistedStorageKey: null })).toBe(true)
    expect(isPoisonedPredictionAttempt({ status: "processing", persistedStorageKey: null })).toBe(false)
    expect(isPoisonedPredictionAttempt({ status: "failed", persistedStorageKey: "media/1.mp4" })).toBe(false)
  })

  it("сообщение об исчерпании повторов несёт исходную причину", () => {
    expect(exhaustedAttemptsMessage(BASE_KEY, 5, "CUDA out of memory"))
      .toContain("CUDA out of memory")
  })
})

describe("Replicate: перезапуск после терминального падения", () => {
  it("открывает новую попытку вместо вечного падения на отравленном ключе", async () => {
    const repository = createRepositoryStub([{
      id: "internal_0",
      externalId: "external_dead",
      idempotencyKey: BASE_KEY,
      status: "failed",
      errorMessage: "prediction failed",
      outputUrl: null,
      persistedStorageKey: null,
      persistenceStatus: "pending",
    }])
    const create = vi.fn(async (request: Record<string, any>) => normalized({
      externalId: `external_${request.idempotencyKey}`,
    }))
    const service = createPredictionService({
      repository: repository as never,
      provider: { name: "replicate", create, get: vi.fn(), cancel: vi.fn() },
      persistOutput: vi.fn(),
      sleep: vi.fn(),
    })

    const prediction = await service.submitOrResumePrediction(submission)

    expect(create).toHaveBeenCalledTimes(1)
    expect(prediction.idempotencyKey).toBe(`${BASE_KEY}#retry-2`)
    expect(prediction.status).toBe("processing")
  })

  it("внутри одной попытки повторный вызов не создаёт второй prediction", async () => {
    const repository = createRepositoryStub()
    const create = vi.fn(async () => normalized())
    const service = createPredictionService({
      repository: repository as never,
      provider: { name: "replicate", create, get: vi.fn(), cancel: vi.fn() },
      persistOutput: vi.fn(),
      sleep: vi.fn(),
    })

    await service.submitOrResumePrediction(submission)
    await service.submitOrResumePrediction(submission)

    expect(create).toHaveBeenCalledTimes(1)
    expect(repository.rows.size).toBe(1)
  })

  it("после исчерпания попыток бросает понятную ошибку с исходной причиной", async () => {
    const seed = Array.from({ length: MAX_PREDICTION_ATTEMPTS }, (_, index) => ({
      id: `internal_${index}`,
      externalId: `external_${index}`,
      idempotencyKey: planPredictionAttempt(BASE_KEY, index + 1)!.key,
      status: "failed",
      errorMessage: "CUDA out of memory",
      outputUrl: null,
      persistedStorageKey: null,
      persistenceStatus: "pending",
    }))
    const create = vi.fn()
    const service = createPredictionService({
      repository: createRepositoryStub(seed) as never,
      provider: { name: "replicate", create, get: vi.fn(), cancel: vi.fn() },
      persistOutput: vi.fn(),
      sleep: vi.fn(),
    })

    await expect(service.submitOrResumePrediction(submission))
      .rejects.toThrow(/исчерпан лимит повторов \(5\).*CUDA out of memory/s)
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Replicate: финализация по вебхуку", () => {
  it("finalizePrediction переносит результат в хранилище по внутреннему id", async () => {
    const repository = createRepositoryStub([{
      id: "internal_1",
      externalId: "external_1",
      idempotencyKey: BASE_KEY,
      status: "succeeded",
      outputUrl: "https://replicate.delivery/out.mp4",
      persistedStorageKey: null,
      persistenceStatus: "pending",
    }])
    const persistOutput = vi.fn(async () => ({
      storageKey: "contentfactory/media-predictions/internal_1/output.mp4",
      storageProvider: "mock",
      fileSizeBytes: 10n,
      fileSha256: "sha",
      contentType: "video/mp4",
    }))
    const service = createPredictionService({
      repository: repository as never,
      provider: { name: "replicate", create: vi.fn(), get: vi.fn(), cancel: vi.fn() },
      persistOutput,
      sleep: vi.fn(),
    })

    const finalized = await service.finalizePrediction("internal_1")

    expect(persistOutput).toHaveBeenCalledTimes(1)
    expect(finalized.persistedStorageKey).toContain("output.mp4")
  })

  it("запускает перенос только для успеха без файла в хранилище", async () => {
    const finalize = vi.fn(async () => undefined)
    const config = { mockMode: true } as never

    finalizeAfterWebhook({ id: "a", status: "processing", persistedStorageKey: null }, config, { finalize })
    finalizeAfterWebhook({ id: "b", status: "succeeded", persistedStorageKey: "media/b.mp4" }, config, { finalize })
    finalizeAfterWebhook({ id: "c", status: "succeeded", persistedStorageKey: null }, config, { finalize })
    await Promise.resolve()

    expect(needsWebhookFinalization({ id: "c", status: "succeeded", persistedStorageKey: null })).toBe(true)
    expect(finalize.mock.calls).toEqual([["c"]])
  })

  it("не роняет обработчик, если перенос упал", async () => {
    const log = vi.fn()
    const finalize = vi.fn(async () => { throw new Error("storage недоступен") })

    expect(() => finalizeAfterWebhook(
      { id: "c", status: "succeeded", persistedStorageKey: null },
      { mockMode: true } as never,
      { finalize, log },
    )).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(log).toHaveBeenCalledWith(expect.stringContaining("storage недоступен"))
  })
})

describe("Replicate: отмена задач ролика", () => {
  it("переводит живые prediction'ы в canceled и считает неудачи по отдельности", async () => {
    const records = [
      { id: "p1", externalId: "external_1", status: "processing", persistedStorageKey: null },
      { id: "p2", externalId: "external_2", status: "starting", persistedStorageKey: null },
    ]
    const repository = {
      findActiveByVideoId: vi.fn(async () => records as never),
      applyStatusUpdate: vi.fn(async (externalId: string, status: string) => {
        const row = records.find(item => item.externalId === externalId)!
        row.status = status
        return row as never
      }),
    }
    const cancel = vi.fn(async (externalId: string) => {
      if (externalId === "external_2") throw new Error("429 rate limited")
      return normalized({ externalId, status: "canceled" })
    })
    const log = vi.fn()

    const result = await runReplicateCancellation(7, {
      repository,
      provider: { name: "replicate", create: vi.fn(), get: vi.fn(), cancel },
      log,
    })

    expect(result).toEqual({ canceled: 1, failed: 1 })
    expect(records[0]!.status).toBe("canceled")
    expect(log).toHaveBeenCalledWith(expect.stringContaining("external_2"))
  })

  it("не навязывает canceled поверх успевшей завершиться задачи", async () => {
    const records = [{ id: "p1", externalId: "external_1", status: "processing", persistedStorageKey: null }]
    const repository = {
      findActiveByVideoId: vi.fn(async () => records as never),
      applyStatusUpdate: vi.fn(async (_externalId: string, status: string) => {
        records[0]!.status = status
        return records[0] as never
      }),
    }

    const result = await runReplicateCancellation(7, {
      repository,
      provider: {
        name: "replicate",
        create: vi.fn(),
        get: vi.fn(),
        cancel: vi.fn(async () => normalized({ status: "succeeded", outputUrl: "https://x/out.mp4" })),
      },
      log: vi.fn(),
    })

    expect(repository.applyStatusUpdate).toHaveBeenCalledWith("external_1", "succeeded", expect.anything())
    expect(result).toEqual({ canceled: 0, failed: 0 })
  })

  it("автомат состояний разрешает отмену из starting и processing", () => {
    expect(transitionPredictionStatus("starting", "canceled").terminal).toBe(true)
    expect(transitionPredictionStatus("processing", "canceled").changed).toBe(true)
  })
})
