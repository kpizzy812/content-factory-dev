import { describe, expect, it, vi } from "vitest"

import { buildLipSyncIdentity } from "../../../server/utils/media-provider/lip-sync-identity"
import { resolveMediaModel } from "../../../server/utils/media-provider/registry"
import {
  classifyPoisonedAttempt,
  consumesAttemptBudget,
  MAX_ENTITY_ATTEMPT_CEILING,
  MAX_PERSISTENCE_ATTEMPTS,
  MAX_PREDICTION_ATTEMPTS,
  planPredictionAttempt,
} from "../../../server/utils/replicate/attempt-key"
import { createMediaPredictionRepository } from "../../../server/utils/replicate/prediction-repository"
import { createPredictionService } from "../../../server/utils/replicate/prediction-service"

/**
 * Регрессии на три дефекта бюджета попыток Replicate:
 *
 * 1. Запись «succeeded без файла» (ссылка replicate.delivery протухла) не
 *    считалась отравленной: новый ключ не открывался, каждый перезапуск падал
 *    на ней же, а планировщик восстановления добивал её раз в минуту вечно.
 * 2. Бюджет считался по идемпотентному ключу, в который входит хэш каждый раз
 *    пересинтезируемого TTS: на перезапуске шага ключ другой, потолок не
 *    связывал ничего, и двадцать перезапусков = двадцать оплат. Держит этот
 *    край теперь ШИРОКАЯ область (ролик + сцена + модель, без отпечатков) —
 *    узкая раздаёт свежий бюджет каждому новому исходнику намеренно, см.
 *    replicate-attempt-scope.spec.ts.
 * 3. Отмена оператором съедала попытку из бюджета, хотя провайдер тут ни при чём.
 */

const IDENTITY = buildLipSyncIdentity({
  videoId: 42,
  sceneOrder: 3,
  modelId: resolveMediaModel("lip_sync").id,
  sourceFingerprint: "source-sha",
  audioFingerprint: "audio-sha",
})

const submission = {
  model: resolveMediaModel("lip_sync"),
  input: { video_url: "https://cdn.example.com/v.mp4", audio_file: "https://cdn.example.com/a.mp3" },
  webhookUrl: "https://factory.example.com/api/webhooks/replicate",
  idempotencyKey: IDENTITY.idempotencyKey,
  attemptScope: IDENTITY.attemptScope,
  attemptCeilingScope: IDENTITY.attemptCeilingScope,
  videoId: 42,
  videoAssetId: 21,
}

function row(overrides: Record<string, any> & { idempotencyKey: string }) {
  return {
    id: `internal_${overrides.idempotencyKey}`,
    externalId: null,
    status: "starting",
    outputUrl: null,
    errorMessage: null,
    persistedStorageKey: null,
    persistenceStatus: "pending",
    persistenceAttemptCount: 0,
    persistenceError: null,
    ...overrides,
  }
}

function createRepository(
  seed: Array<Record<string, any>> = [],
  // Считаем по областям адресно: узкая (набор исходников) и широкая (сцена)
  // живут своими бюджетами, и подменять их одним числом больше нельзя.
  spentByScope: Record<string, number> = {},
) {
  const rows = new Map<string, Record<string, any>>(seed.map(item => [item.idempotencyKey, item]))
  const byId = (id: string) => [...rows.values()].find(item => item.id === id)!

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
      record.persistenceAttemptCount += 1
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
      record.persistenceError = error
      return record
    }),
    findRecoverable: vi.fn(async () => []),
    countSpentAttemptsInScope: vi.fn(async (scope: string) => spentByScope[scope] ?? 0),
  }
}

function providerPrediction(idempotencyKey: string, status = "processing") {
  return {
    externalId: `external:${idempotencyKey}`,
    provider: "replicate" as const,
    model: submission.model.id,
    status: status as never,
    outputUrl: null,
    error: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    startedAt: new Date("2026-02-01T00:00:00.000Z"),
    completedAt: null,
    raw: {},
  }
}

function createService(repository: ReturnType<typeof createRepository>, create = vi.fn()) {
  return {
    create,
    service: createPredictionService({
      repository: repository as never,
      provider: { name: "replicate", create, get: vi.fn(), cancel: vi.fn() } as never,
      persistOutput: vi.fn(),
      sleep: vi.fn(),
    }),
  }
}

describe("Replicate: протухший результат освобождает ключ", () => {
  it("succeeded без файла с исчерпанным переносом считается отравленным", () => {
    const lost = {
      status: "succeeded",
      persistedStorageKey: null,
      persistenceStatus: "failed",
      persistenceAttemptCount: MAX_PERSISTENCE_ATTEMPTS,
    }
    expect(classifyPoisonedAttempt(lost)).toBe("lost")
    // Пока повторы переноса не исчерпаны, запись живая: ссылка может ожить.
    expect(classifyPoisonedAttempt({ ...lost, persistenceAttemptCount: 1 })).toBeNull()
    // Перенос ещё не пробовали — тем более не отравлена.
    expect(classifyPoisonedAttempt({ ...lost, persistenceStatus: "pending" })).toBeNull()
  })

  it("следующий прогон уходит провайдеру, а не падает вечно на протухшей записи", async () => {
    const repository = createRepository([row({
      idempotencyKey: IDENTITY.idempotencyKey,
      externalId: "external_dead",
      status: "succeeded",
      outputUrl: "https://replicate.delivery/expired.mp4",
      persistenceStatus: "failed",
      persistenceAttemptCount: MAX_PERSISTENCE_ATTEMPTS,
      persistenceError: "404 Not Found",
    })])
    const { create, service } = createService(
      repository,
      vi.fn(async (request: { idempotencyKey: string }) => providerPrediction(request.idempotencyKey)),
    )

    const prediction = await service.submitOrResumePrediction(submission)

    expect(create).toHaveBeenCalledTimes(1)
    expect(prediction.idempotencyKey).toBe(`${IDENTITY.idempotencyKey}#retry-2`)
  })

  it("счётчик переносов растёт даже когда ссылки в записи уже нет", async () => {
    const repository = createRepository([row({
      idempotencyKey: IDENTITY.idempotencyKey,
      externalId: "external_dead",
      status: "succeeded",
      outputUrl: null,
    })])
    const { service } = createService(repository)

    // Без инкремента такая запись никогда не набрала бы лимит и держала бы
    // ключ вечно — ровно та «невосстановимость», ради которой всё затевалось.
    await expect(service.finalizePrediction(`internal_${IDENTITY.idempotencyKey}`))
      .rejects.toThrow("output is missing or expired")
    expect(repository.rows.get(IDENTITY.idempotencyKey)!.persistenceAttemptCount).toBe(1)
  })

  it("мёртвая запись выпадает из выборки восстановления", async () => {
    const findMany = vi.fn(async () => [])
    const repository = createMediaPredictionRepository({
      mediaPrediction: { findMany } as never,
    } as never)

    await repository.findRecoverable(20)

    const where = findMany.mock.calls[0]![0].where as Record<string, any>
    for (const branch of where.OR.slice(1)) {
      expect(branch.persistenceAttemptCount).toEqual({ lt: MAX_PERSISTENCE_ATTEMPTS })
    }
  })
})

describe("Replicate: перезапуски шага не раздают бесконечно много бюджетов", () => {
  it("новая цепочка ключей не открывается, если сцена упёрлась в общий потолок", async () => {
    // Переозвучка сцены дала другой хэш аудио — ключ и узкая область другие,
    // сущность (ролик + сцена + модель) та же.
    const reheard = buildLipSyncIdentity({
      videoId: 42,
      sceneOrder: 3,
      modelId: resolveMediaModel("lip_sync").id,
      sourceFingerprint: "source-sha",
      audioFingerprint: "audio-sha-2",
    })
    expect(reheard.attemptCeilingScope).toBe(IDENTITY.attemptCeilingScope)
    expect(reheard.attemptScope).not.toBe(IDENTITY.attemptScope)
    expect(reheard.idempotencyKey).not.toBe(IDENTITY.idempotencyKey)

    // Узкая область у переозвучки чистая — ловит именно широкий потолок.
    const repository = createRepository([], {
      [IDENTITY.attemptCeilingScope]: MAX_ENTITY_ATTEMPT_CEILING,
    })
    const { create, service } = createService(repository)

    await expect(service.submitOrResumePrediction({
      ...submission,
      idempotencyKey: reheard.idempotencyKey,
      attemptScope: reheard.attemptScope,
      attemptCeilingScope: reheard.attemptCeilingScope,
    })).rejects.toThrow(/исчерпан общий потолок попыток \(15\)/)

    // Ни оплаты, ни новой записи: раньше здесь стартовала лишняя оплаченная цепочка.
    expect(create).not.toHaveBeenCalled()
    expect(repository.rows.size).toBe(0)
    expect(repository.countSpentAttemptsInScope).toHaveBeenCalledWith(IDENTITY.attemptCeilingScope)
  })

  it("узкая область бюджета — сам ключ, широкая — его строгий префикс", () => {
    // По узкой считаются сам базовый ключ и цепочка ретраев (через `#`),
    // по широкой — все наборы исходников этой сцены (через `:`).
    expect(IDENTITY.attemptScope).toBe(IDENTITY.idempotencyKey)
    expect(IDENTITY.idempotencyKey.startsWith(`${IDENTITY.attemptCeilingScope}:`)).toBe(true)
    expect(planPredictionAttempt(IDENTITY.idempotencyKey, 3)!.key)
      .toBe(`${IDENTITY.attemptScope}#retry-3`)
  })
})

describe("Replicate: отмена не съедает бюджет повторов", () => {
  it("отменённая попытка открывает новый ключ, но лимит не тратит", async () => {
    expect(consumesAttemptBudget("canceled")).toBe(false)
    expect(consumesAttemptBudget("failed")).toBe(true)
    expect(consumesAttemptBudget("lost")).toBe(true)

    // Оператор отменил ролик пять раз — типовая история «не тот пресентер».
    const seed = Array.from({ length: MAX_PREDICTION_ATTEMPTS }, (_, index) => row({
      idempotencyKey: planPredictionAttempt(IDENTITY.idempotencyKey, index + 1)!.key,
      externalId: `external_${index}`,
      status: "canceled",
    }))
    const repository = createRepository(seed)
    const { create, service } = createService(
      repository,
      vi.fn(async (request: { idempotencyKey: string }) => providerPrediction(request.idempotencyKey)),
    )

    const prediction = await service.submitOrResumePrediction(submission)

    // Раньше шестой прогон падал «исчерпан лимит повторов» с пустой причиной,
    // ошибка глоталась в runner'е, и ролик молча уезжал в сборку без lip-sync.
    expect(create).toHaveBeenCalledTimes(1)
    expect(prediction.idempotencyKey).toBe(`${IDENTITY.idempotencyKey}#retry-6`)
    expect(prediction.status).toBe("processing")
  })

  it("настоящие неудачи бюджет по-прежнему тратят", async () => {
    const seed = Array.from({ length: MAX_PREDICTION_ATTEMPTS }, (_, index) => row({
      idempotencyKey: planPredictionAttempt(IDENTITY.idempotencyKey, index + 1)!.key,
      externalId: `external_${index}`,
      status: "failed",
      errorMessage: "CUDA out of memory",
    }))
    const repository = createRepository(seed)
    const { create, service } = createService(repository)

    await expect(service.submitOrResumePrediction(submission))
      .rejects.toThrow(/исчерпан лимит повторов \(5\).*CUDA out of memory/s)
    expect(create).not.toHaveBeenCalled()
  })
})
