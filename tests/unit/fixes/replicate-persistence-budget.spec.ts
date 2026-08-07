import { describe, expect, it, vi } from "vitest"

import {
  classifyPoisonedAttempt,
  isTransientPersistenceFailure,
  MAX_PERSISTENCE_ATTEMPTS,
} from "../../../server/utils/replicate/attempt-key"
import { createMediaPredictionRepository } from "../../../server/utils/replicate/prediction-repository"
import { createPredictionService } from "../../../server/utils/replicate/prediction-service"

/**
 * Регрессия: бюджет переносов результата в хранилище сжигался отказом хранилища.
 *
 * `MAX_PERSISTENCE_ATTEMPTS` делят три независимых финализатора — вебхук
 * (finalizeAfterWebhook), polling внутри waitForPrediction и recovery-плагин.
 * Каждый берёт заявку через claimPersistence, а тот инкрементит
 * persistenceAttemptCount. Двухминутная недоступность MinIO/S3 давала три-четыре
 * неудачи подряд, счётчик добивал до потолка, запись классифицировалась как
 * «lost», её идемпотентный ключ отравлялся — и оплаченный результат Replicate
 * терялся навсегда, хотя файл на стороне провайдера был ещё жив.
 *
 * Лечение: «не смогли перенести по устранимой причине» отделено от «переносить
 * нечего». Устранимая неудача возвращает заявку в бюджет, неустранимая (404/410
 * по ссылке, отсутствие ссылки, всё неопознанное) — тратит, как раньше.
 */

const PREDICTION_ID = "internal_persist_budget"

interface FakeRow {
  id: string
  idempotencyKey: string
  externalId: string | null
  status: string
  outputUrl: string | null
  errorMessage: string | null
  persistedStorageKey: string | null
  persistenceStatus: string
  persistenceAttemptCount: number
  persistenceError: string | null
  [key: string]: unknown
}

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: PREDICTION_ID,
    idempotencyKey: "video:7:scene:2:lip_sync:src:aud",
    externalId: "external_persist_budget",
    status: "succeeded",
    outputUrl: "https://replicate.delivery/pbxt/output.mp4",
    errorMessage: null,
    persistedStorageKey: null,
    persistenceStatus: "pending",
    persistenceAttemptCount: 0,
    persistenceError: null,
    ...overrides,
  }
}

/**
 * Двойник репозитория с семантикой боевого: заявка — атомарный CAS с
 * инкрементом, а откат счётчика управляется флагом retriable.
 */
function createRepository(row: FakeRow) {
  return {
    row,
    createOrRead: vi.fn(async () => row),
    findById: vi.fn(async (id: string) => (id === row.id ? row : null)),
    attachExternalId: vi.fn(),
    applyStatusUpdate: vi.fn(),
    claimPersistence: vi.fn(async (id: string) => {
      if (id !== row.id) return false
      if (row.status !== "succeeded") return false
      if (row.persistedStorageKey) return false
      if (!["pending", "failed"].includes(row.persistenceStatus)) return false
      row.persistenceStatus = "persisting"
      row.persistenceError = null
      row.persistenceAttemptCount += 1
      return true
    }),
    markOutputPersisted: vi.fn(async (_id: string, asset: { storageKey: string }) => {
      row.persistenceStatus = "persisted"
      row.persistenceError = null
      row.persistedStorageKey = asset.storageKey
      return row
    }),
    markPersistenceFailed: vi.fn(async (
      _id: string,
      error: string,
      options: { retriable?: boolean } = {},
    ) => {
      row.persistenceStatus = "failed"
      row.persistenceError = error
      if (options.retriable) row.persistenceAttemptCount -= 1
      return row
    }),
    findRecoverable: vi.fn(async () => [row]),
  }
}

function createService(repository: ReturnType<typeof createRepository>, persistOutput: unknown) {
  return createPredictionService({
    repository: repository as never,
    provider: { name: "replicate", create: vi.fn(), get: vi.fn(), cancel: vi.fn() } as never,
    persistOutput: persistOutput as never,
    sleep: vi.fn(),
  })
}

/** Прокрутка микрозадач: гонку проверяем без таймеров. */
async function flush(times = 20): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

const STORAGE_ASSET = {
  storageKey: `contentfactory/media-predictions/${PREDICTION_ID}/output.mp4`,
  storageProvider: "minio",
  fileSizeBytes: 1_024n,
  fileSha256: "sha256",
  contentType: "video/mp4",
}

describe("Replicate: отказ хранилища не сжигает бюджет переносов", () => {
  it("пять неудач подряд по 503 не превращают запись в «lost»", async () => {
    const repository = createRepository(makeRow())
    const persistOutput = vi.fn(async () => {
      throw new Error("MinIO: 503 Service Unavailable")
    })
    const service = createService(repository, persistOutput)

    // Вебхук, polling и recovery по очереди бьются об лежащий MinIO.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.finalizePrediction(PREDICTION_ID)).rejects.toThrow("503")
    }

    // Раньше здесь было 5 сожжённых попыток и приговор «lost»: ключ отравлен,
    // оплаченный результат Replicate больше не забрать.
    expect(repository.row.persistenceAttemptCount).toBe(0)
    expect(classifyPoisonedAttempt(repository.row)).toBeNull()
    expect(persistOutput).toHaveBeenCalledTimes(5)
  })

  it("после того как хранилище поднялось, результат всё ещё забирается", async () => {
    const repository = createRepository(makeRow())
    const persistOutput = vi.fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:9000"))
      .mockRejectedValueOnce(new Error("upload timed out after 30000ms"))
      .mockRejectedValueOnce(new Error("502 Bad Gateway"))
      .mockResolvedValue(STORAGE_ASSET)
    const service = createService(repository, persistOutput as never)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(service.finalizePrediction(PREDICTION_ID)).rejects.toThrow()
    }
    const persisted = await service.finalizePrediction(PREDICTION_ID)

    expect(persisted.persistedStorageKey).toBe(STORAGE_ASSET.storageKey)
    expect(repository.row.persistenceAttemptCount).toBe(1)
  })

  it("устранимая неудача оставляет запись в выборке восстановления", async () => {
    const repository = createRepository(makeRow())
    const service = createService(repository, vi.fn(async () => {
      throw new Error("MinIO: 503 Service Unavailable")
    }) as never)

    // Отказ длиннее бюджета: recovery успевает сходить больше трёх раз.
    for (let attempt = 0; attempt < MAX_PERSISTENCE_ATTEMPTS + 1; attempt += 1) {
      await expect(service.finalizePrediction(PREDICTION_ID)).rejects.toThrow()
    }

    // Сверяемся с настоящим условием выборки, а не с его пересказом.
    const findMany = vi.fn(async () => [])
    await createMediaPredictionRepository({ mediaPrediction: { findMany } as never } as never)
      .findRecoverable(20)
    const where = findMany.mock.calls[0]![0].where as Record<string, any>
    const succeededBranch = where.OR.find(
      (branch: Record<string, any>) => branch.status === "succeeded"
        && branch.persistenceStatus?.in?.includes("failed"),
    )

    expect(succeededBranch).toBeTruthy()
    expect(matchesWhere(where, repository.row, { skipOr: true })).toBe(true)
    expect(matchesWhere(succeededBranch, repository.row)).toBe(true)
  })

  it("неустранимая ошибка бюджет по-прежнему тратит и освобождает ключ", async () => {
    const repository = createRepository(makeRow())
    const persistOutput = vi.fn(async () => {
      throw new Error("404 Not Found: https://replicate.delivery/pbxt/output.mp4")
    })
    const service = createService(repository, persistOutput)

    for (let attempt = 0; attempt < MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
      await expect(service.finalizePrediction(PREDICTION_ID)).rejects.toThrow("404")
    }

    // Иначе получили бы обратный дефект: протухшая ссылка держала бы ключ вечно.
    expect(repository.row.persistenceAttemptCount).toBe(MAX_PERSISTENCE_ATTEMPTS)
    expect(classifyPoisonedAttempt(repository.row)).toBe("lost")
  })

  it("запись без ссылки на результат остаётся неустранимой", async () => {
    const repository = createRepository(makeRow({ outputUrl: null }))
    const service = createService(repository, vi.fn())

    await expect(service.finalizePrediction(PREDICTION_ID))
      .rejects.toThrow("output is missing or expired")

    expect(repository.row.persistenceAttemptCount).toBe(1)
    expect(repository.markPersistenceFailed).toHaveBeenCalledWith(
      PREDICTION_ID,
      expect.stringContaining("missing or expired"),
    )
  })
})

describe("Replicate: классификация ошибок переноса", () => {
  it("сетевые отказы и 5xx хранилища считаются устранимыми", () => {
    const transient: unknown[] = [
      new Error("MinIO: 503 Service Unavailable"),
      new Error("S3 responded 500 Internal Server Error"),
      new Error("upload failed: 504 Gateway Timeout"),
      new Error("socket hang up"),
      new Error("request timed out"),
      Object.assign(new Error("connect failed"), { code: "ECONNRESET" }),
      Object.assign(new Error("write failed"), { code: "EPIPE" }),
      // undici прячет причину в cause — плоского message тут недостаточно.
      new Error("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:9000"), {
          code: "ECONNREFUSED",
        }),
      }),
      "SlowDown",
      { message: "throttled", status: 429 },
    ]

    for (const error of transient) {
      expect(isTransientPersistenceFailure(error), String(error)).toBe(true)
    }
  })

  it("протухшая ссылка и всё неопознанное считаются неустранимыми", () => {
    const permanent: unknown[] = [
      new Error("404 Not Found"),
      new Error("410 Gone"),
      new Error("Replicate output is missing or expired for prediction internal_1"),
      new Error("unsupported content type"),
      new Error(""),
      null,
      undefined,
    ]

    // Неизвестное намеренно неустранимо: иначе запись «succeeded без файла»
    // держала бы свой идемпотентный ключ вечно и ролик было бы не пересобрать.
    for (const error of permanent) {
      expect(isTransientPersistenceFailure(error), String(error)).toBe(false)
    }
  })
})

describe("Replicate: заявка на перенос под гонкой вебхука и polling", () => {
  it("одновременная финализация качает файл ровно один раз", async () => {
    const repository = createRepository(makeRow())
    let release = () => {}
    const upload = new Promise<void>((resolve) => { release = resolve })
    const persistOutput = vi.fn(async () => {
      await upload
      return STORAGE_ASSET
    })
    const service = createService(repository, persistOutput)

    // Вебхук и polling заходят в одну и ту же запись в один тик.
    const both = Promise.all([
      service.finalizePrediction(PREDICTION_ID),
      service.finalizePrediction(PREDICTION_ID),
    ])
    await flush()

    expect(repository.claimPersistence).toHaveBeenCalledTimes(2)
    expect(persistOutput).toHaveBeenCalledTimes(1)
    expect(repository.row.persistenceAttemptCount).toBe(1)

    release()
    const [first, second] = await both

    expect(repository.markPersistenceFailed).not.toHaveBeenCalled()
    // Проигравший заявку не падает и не портит счётчик — просто перечитывает.
    expect(first.persistedStorageKey ?? second.persistedStorageKey)
      .toBe(STORAGE_ASSET.storageKey)
  })
})

describe("Replicate: репозиторий откатывает заявку только для устранимых ошибок", () => {
  it("retriable даёт декремент счётчика, обычная ошибка — нет", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const findUnique = vi.fn(async () => makeRow())
    const repository = createMediaPredictionRepository({
      mediaPrediction: { updateMany, findUnique } as never,
    } as never)

    await repository.markPersistenceFailed("internal_1", "503 Service Unavailable", {
      retriable: true,
    })
    await repository.markPersistenceFailed("internal_1", "404 Not Found")

    expect(updateMany.mock.calls[0]![0]).toEqual({
      // persistedStorageKey в условии: опоздавший неудачник не должен откатывать
      // уже сохранённый результат обратно в «failed».
      where: { id: "internal_1", persistedStorageKey: null },
      data: {
        persistenceStatus: "failed",
        persistenceError: "503 Service Unavailable",
        persistenceAttemptCount: { decrement: 1 },
      },
    })
    expect(updateMany.mock.calls[1]![0].data).not.toHaveProperty("persistenceAttemptCount")
  })
})

describe("Replicate: зависшая заявка на перенос", () => {
  it("заявку, брошенную умершим процессом, можно перезахватить", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const repository = createMediaPredictionRepository({
      mediaPrediction: { updateMany } as never,
    } as never)

    await repository.claimPersistence("internal_1")
    const where = updateMany.mock.calls[0]![0].where as Record<string, any>

    // Раньше заявка требовала persistenceStatus ∈ [pending, failed], а сбросить
    // «persisting» после падения процесса было некому: findRecoverable выбирала
    // запись раз в минуту, claimPersistence всегда отвечала «нет», и ключ
    // оставался запертым навсегда.
    const stale = {
      id: "internal_1",
      status: "succeeded",
      persistedStorageKey: null,
      persistenceStatus: "persisting",
      persistenceStartedAt: new Date(Date.now() - 10 * 60 * 1000),
      persistenceAttemptCount: 1,
    }
    expect(matchesWhere(where, stale)).toBe(true)

    // Живая заявка (перенос идёт прямо сейчас) по-прежнему чужая.
    expect(matchesWhere(where, { ...stale, persistenceStartedAt: new Date() })).toBe(false)
  })
})

/** Мини-интерпретатор where Prisma: нужен, чтобы сверять строку с боевым фильтром. */
function matchesWhere(
  where: Record<string, any>,
  row: Record<string, any>,
  options: { skipOr?: boolean } = {},
): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (field === "OR") return options.skipOr ? true : (condition as any[]).some(branch => matchesWhere(branch, row))
    const value = row[field]
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      if ("in" in condition) return (condition.in as unknown[]).includes(value)
      if ("lt" in condition) return (value as number) < (condition.lt as number)
      if ("lte" in condition) return value instanceof Date && value <= (condition.lte as Date)
      if ("not" in condition) return value !== condition.not
      throw new Error(`Неподдержанное условие для ${field}: ${JSON.stringify(condition)}`)
    }
    return value === condition
  })
}
