import { describe, expect, it, vi } from "vitest"

import { resolveMediaModel } from "../../../server/utils/media-provider/registry"
import { MAX_PREDICTION_ATTEMPTS, planPredictionAttempt } from "../../../server/utils/replicate/attempt-key"
import {
  cancelReplicatePredictionsForVideo,
  runReplicateCancellation,
} from "../../../server/utils/replicate/cancel"
import { createPredictionService } from "../../../server/utils/replicate/prediction-service"

/**
 * Регрессии на два дефекта контура Replicate:
 *
 * 1. Идемпотентный ключ считается от отпечатков исходников, поэтому терминально
 *    упавшая запись навсегда «отравляла» ключ: повторный прогон читал failed и
 *    падал, не дойдя до провайдера. Ролик становился невосстановимым.
 * 2. Отмена ролика гасила только fal-шаги, а lip-sync на Replicate продолжал
 *    считаться и списывать деньги.
 */

const BASE_KEY = "lip-sync:v1:video:9:scene:2:source:src-hash:audio:audio-hash"

const submission = {
  model: resolveMediaModel("lip_sync"),
  input: { video_url: "https://cdn.example.com/v.mp4", audio_file: "https://cdn.example.com/a.mp3" },
  webhookUrl: "https://factory.example.com/api/webhooks/replicate",
  idempotencyKey: BASE_KEY,
  videoId: 9,
  videoAssetId: 21,
}

interface Row {
  id: string
  externalId: string | null
  idempotencyKey: string
  status: string
  outputUrl: string | null
  errorMessage: string | null
  persistedStorageKey: string | null
  persistenceStatus: string
}

function row(overrides: Partial<Row> & { idempotencyKey: string }): Row {
  return {
    id: `internal_${overrides.idempotencyKey}`,
    externalId: null,
    status: "starting",
    outputUrl: null,
    errorMessage: null,
    persistedStorageKey: null,
    persistenceStatus: "pending",
    ...overrides,
  }
}

/**
 * Подмена таблицы MediaPrediction. Уникальность externalId воспроизведена
 * намеренно: старый код отдавал провайдеру базовый ключ, mock-провайдер выводил
 * из него один и тот же externalId, и вторая попытка ложилась на дубль.
 */
function createRepository(seed: Row[] = []) {
  const rows = new Map<string, Row>(seed.map(item => [item.idempotencyKey, item]))

  const byId = (id: string) => {
    const found = [...rows.values()].find(item => item.id === id)
    if (!found) throw new Error(`нет записи ${id}`)
    return found
  }

  return {
    rows,
    createOrRead: vi.fn(async (input: { idempotencyKey: string }) => {
      const existing = rows.get(input.idempotencyKey)
      if (existing) return existing
      const created = row({ idempotencyKey: input.idempotencyKey })
      rows.set(created.idempotencyKey, created)
      return created
    }),
    findById: vi.fn(async (id: string) => byId(id)),
    attachExternalId: vi.fn(async (id: string, externalId: string) => {
      if ([...rows.values()].some(item => item.externalId === externalId)) {
        throw new Error(`Дубль externalId ${externalId}`)
      }
      const record = byId(id)
      record.externalId = externalId
      record.status = "starting"
      return record
    }),
    applyStatusUpdate: vi.fn(async (externalId: string, status: string, patch: Record<string, unknown>) => {
      const record = [...rows.values()].find(item => item.externalId === externalId)!
      Object.assign(record, patch, { status })
      return record
    }),
    claimPersistence: vi.fn(async (id: string) => {
      const record = byId(id)
      if (record.persistedStorageKey || record.persistenceStatus === "persisting") return false
      record.persistenceStatus = "persisting"
      return true
    }),
    markOutputPersisted: vi.fn(async (id: string, asset: { storageKey: string }) => {
      const record = byId(id)
      record.persistenceStatus = "persisted"
      record.persistedStorageKey = asset.storageKey
      return record
    }),
    markPersistenceFailed: vi.fn(async (id: string, error: string) => {
      const record = byId(id)
      record.persistenceStatus = "failed"
      record.errorMessage = error
      return record
    }),
    findRecoverable: vi.fn(async () => []),
  }
}

/** Ответ провайдера. externalId выводится из ключа — как в mock-провайдере. */
function providerPrediction(idempotencyKey: string, status: string, error: string | null = null) {
  return {
    externalId: `external:${idempotencyKey}`,
    provider: "replicate" as const,
    model: submission.model.id,
    status: status as never,
    outputUrl: null,
    error,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    startedAt: new Date("2026-02-01T00:00:00.000Z"),
    completedAt: status === "failed" ? new Date("2026-02-01T00:01:00.000Z") : null,
    raw: {},
  }
}

describe("Replicate: терминальная неудача не запирает ролик", () => {
  it("следующая попытка уходит провайдеру с производным ключом, а не с отравленным", async () => {
    const repository = createRepository([row({
      idempotencyKey: BASE_KEY,
      externalId: `external:${BASE_KEY}`,
      status: "failed",
      errorMessage: "prediction failed on Replicate",
    })])
    const create = vi.fn(async (request: { idempotencyKey: string }) =>
      providerPrediction(request.idempotencyKey, "processing"),
    )
    const service = createPredictionService({
      repository: repository as never,
      provider: { name: "replicate", create, get: vi.fn(), cancel: vi.fn() } as never,
      persistOutput: vi.fn(),
      sleep: vi.fn(),
    })

    const prediction = await service.submitOrResumePrediction(submission)

    // Суть дефекта: раньше сюда вообще не доходили — падали на failed-записи.
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0]!.idempotencyKey).toBe(`${BASE_KEY}#retry-2`)
    // Ключ попытки обязан дойти до провайдера: иначе externalId совпадёт со
    // старым и запись не привяжется.
    expect(prediction.externalId).toBe(`external:${BASE_KEY}#retry-2`)
    expect(prediction.status).toBe("processing")
    // Старая запись остаётся как есть — история неудач не переписывается.
    expect(repository.rows.get(BASE_KEY)!.status).toBe("failed")
  })

  it("не открывает новую попытку, если результат неудачной записи уже в хранилище", async () => {
    const repository = createRepository([row({
      idempotencyKey: BASE_KEY,
      externalId: `external:${BASE_KEY}`,
      status: "failed",
      errorMessage: "webhook опоздал",
      persistedStorageKey: "contentfactory/media-predictions/internal_1/output.mp4",
      persistenceStatus: "persisted",
    })])
    const create = vi.fn()
    const service = createPredictionService({
      repository: repository as never,
      provider: { name: "replicate", create, get: vi.fn(), cancel: vi.fn() } as never,
      persistOutput: vi.fn(),
      sleep: vi.fn(),
    })

    const prediction = await service.submitOrResumePrediction(submission)

    // Файл есть — платить второй раз не за что.
    expect(create).not.toHaveBeenCalled()
    expect(prediction.idempotencyKey).toBe(BASE_KEY)
    expect(repository.rows.size).toBe(1)
  })

  it("каждая новая попытка получает свой ключ, а после лимита — ошибка с причиной", async () => {
    const repository = createRepository()
    const create = vi.fn(async (request: { idempotencyKey: string }) =>
      providerPrediction(request.idempotencyKey, "failed", `сбой ${request.idempotencyKey}`),
    )
    const service = createPredictionService({
      repository: repository as never,
      provider: { name: "replicate", create, get: vi.fn(), cancel: vi.fn() } as never,
      persistOutput: vi.fn(),
      sleep: vi.fn(),
    })

    // Каждый прогон открывает ровно одну новую попытку: предыдущие отравлены.
    for (let call = 1; call <= MAX_PREDICTION_ATTEMPTS; call += 1) {
      const prediction = await service.submitOrResumePrediction(submission)
      expect(prediction.idempotencyKey).toBe(planPredictionAttempt(BASE_KEY, call)!.key)
      expect(prediction.status).toBe("failed")
    }

    expect(create).toHaveBeenCalledTimes(MAX_PREDICTION_ATTEMPTS)
    expect(create.mock.calls.map(call => call[0]!.idempotencyKey)).toEqual(
      Array.from({ length: MAX_PREDICTION_ATTEMPTS }, (_, index) =>
        planPredictionAttempt(BASE_KEY, index + 1)!.key,
      ),
    )

    // Потолок: систематическая ошибка не должна жечь деньги бесконечно.
    await expect(service.submitOrResumePrediction(submission)).rejects.toThrow(
      new RegExp(`исчерпан лимит повторов \\(${MAX_PREDICTION_ATTEMPTS}\\)`),
    )
    await expect(service.submitOrResumePrediction(submission)).rejects.toThrow(
      // Причина последней попытки должна быть в тексте: иначе оператору нечего читать.
      new RegExp(`сбой ${BASE_KEY}#retry-${MAX_PREDICTION_ATTEMPTS}`),
    )
    expect(create).toHaveBeenCalledTimes(MAX_PREDICTION_ATTEMPTS)
    expect(repository.rows.size).toBe(MAX_PREDICTION_ATTEMPTS)
  })
})

describe("Replicate: отмена задач ролика", () => {
  function createCancellationRepository(records: Array<Partial<Row> & { externalId: string | null }>) {
    const rows = records.map((item, index) => ({
      id: `p${index + 1}`,
      status: "processing",
      persistedStorageKey: null,
      ...item,
    }))
    return {
      rows,
      findActiveByVideoId: vi.fn(async () => rows as never),
      applyStatusUpdate: vi.fn(async (externalId: string, status: string) => {
        const record = rows.find(item => item.externalId === externalId)!
        record.status = status
        return record as never
      }),
    }
  }

  it("сбой одной записи не отменяет остальные и наружу не выходит", async () => {
    const repository = createCancellationRepository([
      { externalId: "external_1" },
      { externalId: "external_2", status: "starting" },
      { externalId: "external_3" },
    ])
    const cancel = vi.fn(async (externalId: string) => {
      if (externalId === "external_2") throw new Error("504 gateway timeout")
      return {
        ...providerPrediction(externalId, "canceled"),
        externalId,
      }
    })
    const log = vi.fn()

    const result = await runReplicateCancellation(9, {
      repository,
      provider: { name: "replicate", create: vi.fn(), get: vi.fn(), cancel } as never,
      log,
    })

    // Именно это и было целью: застрявшая запись в середине списка не должна
    // оставлять оплаченными все последующие сцены.
    expect(repository.rows.map(item => item.status)).toEqual(["canceled", "starting", "canceled"])
    expect(result).toEqual({ canceled: 2, failed: 1 })
    expect(log).toHaveBeenCalledWith(expect.stringContaining("external_2"))
  })

  it("падение репозитория тоже считается неудачей, а не роняет отмену", async () => {
    const repository = {
      findActiveByVideoId: vi.fn(async () => [
        { id: "p1", externalId: "external_1", status: "processing", persistedStorageKey: null },
      ] as never),
      applyStatusUpdate: vi.fn(async () => {
        throw new Error("Cannot move terminal prediction from succeeded to canceled")
      }),
    }

    const result = await runReplicateCancellation(9, {
      repository,
      provider: {
        name: "replicate",
        create: vi.fn(),
        get: vi.fn(),
        cancel: vi.fn(async () => providerPrediction("external_1", "canceled")),
      } as never,
      log: vi.fn(),
    })

    expect(result).toEqual({ canceled: 0, failed: 1 })
  })

  it("не дёргает провайдера для записей, которые ещё не ушли в Replicate", async () => {
    const repository = createCancellationRepository([
      { externalId: null, status: "starting" },
      { externalId: "external_2" },
    ])
    const cancel = vi.fn(async (externalId: string) => providerPrediction(externalId, "canceled"))

    const result = await runReplicateCancellation(9, {
      repository,
      provider: { name: "replicate", create: vi.fn(), get: vi.fn(), cancel } as never,
      log: vi.fn(),
    })

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith("external_2")
    expect(result).toEqual({ canceled: 1, failed: 0 })
  })

  it("при неполной конфигурации возвращает нули и не срывает отмену пайплайна", async () => {
    const keys = [
      "REPLICATE_MOCK_MODE",
      "REPLICATE_API_TOKEN",
      "REPLICATE_WEBHOOK_BASE_URL",
      "REPLICATE_WEBHOOK_SIGNING_SECRET",
    ] as const
    const saved = keys.map(key => [key, process.env[key]] as const)
    for (const key of keys) delete process.env[key]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    try {
      // Ни сети, ни БД: конфигурация бросает раньше, чем создаётся провайдер.
      await expect(cancelReplicatePredictionsForVideo(9)).resolves.toEqual({ canceled: 0, failed: 0 })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("конфигурация Replicate неполна"))
    }
    finally {
      warn.mockRestore()
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
