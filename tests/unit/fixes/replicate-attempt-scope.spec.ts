import { describe, expect, it, vi } from "vitest"

import { buildLipSyncIdentity } from "../../../server/utils/media-provider/lip-sync-identity"
import { resolveMediaModel } from "../../../server/utils/media-provider/registry"
import {
  MAX_ENTITY_ATTEMPT_CEILING,
  MAX_PREDICTION_ATTEMPTS,
  planPredictionAttempt,
} from "../../../server/utils/replicate/attempt-key"
import { createMediaPredictionRepository } from "../../../server/utils/replicate/prediction-repository"
import { createPredictionService } from "../../../server/utils/replicate/prediction-service"

/**
 * Регрессия на «сцена заперта навсегда».
 *
 * Бюджет попыток считался по сущности БЕЗ отпечатков исходников (ролик + сцена
 * + модель) и никогда не сбрасывался. Пять терминальных отказов — типовое
 * «no face detected» на сгенерированном клипе, где лица просто нет, — навсегда
 * запирали сцену: оператор перегенерировал клип, исходник стал ДРУГИМ, а бюджет
 * оставался сожжённым, и новая попытка падала мгновенно, не дойдя до провайдера.
 *
 * Теперь областей две: узкая (с отпечатками) даёт свежий бюджет новому
 * исходнику, широкая (без отпечатков) держит общий потолок, чтобы перезапуски
 * шага TTS не выдавали бесконечно много свежих бюджетов.
 */

const MODEL = resolveMediaModel("lip_sync")

function identityFor(sourceFingerprint: string, audioFingerprint: string) {
  return buildLipSyncIdentity({
    videoId: 42,
    sceneOrder: 3,
    modelId: MODEL.id,
    sourceFingerprint,
    audioFingerprint,
  })
}

const ORIGINAL = identityFor("source-sha-a", "audio-sha-a")
/** Оператор перегенерировал клип: новое видео, та же озвучка. */
const REGENERATED = identityFor("source-sha-b", "audio-sha-a")

function submissionFor(identity: ReturnType<typeof identityFor>) {
  return {
    model: MODEL,
    input: { video_url: "https://cdn.example.com/v.mp4", audio_file: "https://cdn.example.com/a.mp3" },
    webhookUrl: "https://factory.example.com/api/webhooks/replicate",
    idempotencyKey: identity.idempotencyKey,
    attemptScope: identity.attemptScope,
    attemptCeilingScope: identity.attemptCeilingScope,
    videoId: 42,
    videoAssetId: 21,
  }
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

/** Пять терминальных отказов на одном наборе исходников — исчерпанная цепочка. */
function burnedChain(baseKey: string, error = "no face detected in the video") {
  return Array.from({ length: MAX_PREDICTION_ATTEMPTS }, (_, index) => row({
    idempotencyKey: planPredictionAttempt(baseKey, index + 1)!.key,
    externalId: `external_${baseKey}_${index}`,
    status: "failed",
    errorMessage: error,
  }))
}

/**
 * Повторяет предикат SQL-подсчёта: ключ принадлежит области, если он и есть
 * область, лежит уровнем ниже (`:`) или входит в её цепочку попыток (`#`).
 */
function belongsToScope(key: string, scope: string): boolean {
  return key === scope || key.startsWith(`${scope}:`) || key.startsWith(`${scope}#`)
}

function createRepository(seed: Array<Record<string, any>> = []) {
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
    claimPersistence: vi.fn(async () => false),
    markOutputPersisted: vi.fn(),
    markPersistenceFailed: vi.fn(),
    findRecoverable: vi.fn(async () => []),
    countSpentAttemptsInScope: vi.fn(async (scope: string) => [...rows.values()].filter(
      item => belongsToScope(item.idempotencyKey, scope)
        && !item.persistedStorageKey
        && item.status === "failed",
    ).length),
  }
}

function providerPrediction(idempotencyKey: string) {
  return {
    externalId: `external:${idempotencyKey}`,
    provider: "replicate" as const,
    model: MODEL.id,
    status: "processing" as never,
    outputUrl: null,
    error: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    startedAt: new Date("2026-02-01T00:00:00.000Z"),
    completedAt: null,
    raw: {},
  }
}

function createService(repository: ReturnType<typeof createRepository>) {
  const create = vi.fn(async (request: { idempotencyKey: string }) =>
    providerPrediction(request.idempotencyKey))
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

describe("Replicate: бюджет попыток привязан к исходникам", () => {
  it("узкая область — это сам ключ, широкая — её строгий префикс", () => {
    // Раскладка ключа не менялась: узкая область равна прежнему ключу целиком,
    // поэтому уже созданные записи остаются «своими» и миграция не нужна.
    expect(ORIGINAL.attemptScope).toBe(ORIGINAL.idempotencyKey)
    expect(ORIGINAL.attemptScope.startsWith(`${ORIGINAL.attemptCeilingScope}:`)).toBe(true)

    // Перегенерированный клип — другая узкая область, та же широкая.
    expect(REGENERATED.attemptScope).not.toBe(ORIGINAL.attemptScope)
    expect(REGENERATED.attemptCeilingScope).toBe(ORIGINAL.attemptCeilingScope)
  })

  it("перегенерированный клип открывает свежий бюджет", async () => {
    const repository = createRepository(burnedChain(ORIGINAL.idempotencyKey))
    const { create, service } = createService(repository)

    const prediction = await service.submitOrResumePrediction(submissionFor(REGENERATED))

    // Раньше здесь летело «исчерпан лимит повторов (5)»: сцена была заперта
    // навсегда, хотя исходник уже другой.
    expect(create).toHaveBeenCalledTimes(1)
    expect(prediction.idempotencyKey).toBe(REGENERATED.idempotencyKey)
    expect(repository.countSpentAttemptsInScope).toHaveBeenCalledWith(REGENERATED.attemptScope)
  })

  it("зацикливание на ТОМ ЖЕ негодном исходнике по-прежнему ограничено", async () => {
    const repository = createRepository(burnedChain(ORIGINAL.idempotencyKey))
    const { create, service } = createService(repository)

    // Ключ в сообщении — узкая область: оператору видно, что упёрлись именно в
    // эти исходники, и перегенерация клипа даст новый бюджет.
    await expect(service.submitOrResumePrediction(submissionFor(ORIGINAL)))
      .rejects.toThrow(`исчерпан лимит повторов (5) для ${ORIGINAL.idempotencyKey}`)
    expect(create).not.toHaveBeenCalled()
  })

  it("повтор с теми же исходниками не создаёт вторую оплаченную задачу", async () => {
    const live = row({
      idempotencyKey: ORIGINAL.idempotencyKey,
      externalId: "external_live",
      status: "processing",
    })
    const repository = createRepository([live])
    const { create, service } = createService(repository)

    const prediction = await service.submitOrResumePrediction(submissionFor(ORIGINAL))

    // Идемпотентность — исходный смысл ключа: два параллельных прогона одного
    // ролика не должны оплачиваться дважды.
    expect(create).not.toHaveBeenCalled()
    expect(prediction.id).toBe(live.id)
    expect(repository.rows.size).toBe(1)
  })

  it("широкий потолок закрывает сцену, когда смена исходников уже не помогает", async () => {
    // Три полных сожжённых бюджета на трёх разных исходниках.
    const chains = ["a", "b", "c"].flatMap(mark =>
      burnedChain(identityFor(`source-sha-${mark}`, "audio-sha-a").idempotencyKey))
    expect(chains).toHaveLength(MAX_ENTITY_ATTEMPT_CEILING)

    const repository = createRepository(chains)
    const { create, service } = createService(repository)
    const fourth = identityFor("source-sha-d", "audio-sha-a")

    await expect(service.submitOrResumePrediction(submissionFor(fourth)))
      .rejects.toThrow(/исчерпан общий потолок попыток \(15\)/)
    expect(create).not.toHaveBeenCalled()
    expect(repository.rows.size).toBe(MAX_ENTITY_ATTEMPT_CEILING)
  })
})

describe("Replicate: подсчёт области видит и базовый ключ, и цепочку ретраев", () => {
  it("SQL-условие ловит сам ключ, вложенные уровни и попытки через #", async () => {
    const count = vi.fn(async () => 0)
    const repository = createMediaPredictionRepository({
      mediaPrediction: { count } as never,
    } as never)

    await repository.countSpentAttemptsInScope("scope")

    const where = count.mock.calls[0]![0].where as Record<string, any>
    const keyFilters = where.AND[0].OR.map((branch: Record<string, any>) => branch.idempotencyKey)
    // Прежний голый startsWith("scope:") не видел ни базовый ключ узкой области,
    // ни его ретраи — счёт по ней всегда выходил нулевым.
    expect(keyFilters).toContainEqual({ equals: "scope" })
    expect(keyFilters).toContainEqual({ startsWith: "scope:" })
    expect(keyFilters).toContainEqual({ startsWith: "scope#" })
    // Статусный OR не должен потеряться: отменённые записи бюджет не тратят.
    expect(where.AND[1].OR).toContainEqual({ status: "failed" })
    expect(where.persistedStorageKey).toBeNull()
  })
})
