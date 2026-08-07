/**
 * Регрессии учёта попыток и порядка списка загрузок.
 *
 * 1. runUploadPipeline считал попытку дважды. Флаг attemptCounted ставился
 *    после возврата из updateUploadStatus, а внутри неё после записи строки
 *    идёт ещё синхронизация публикации фабрики. Падение синхронизации уводило
 *    прогон в catch с attemptCounted=false, и обработчик ошибки инкрементил
 *    attemptCount второй раз: один реальный заход съедал две из трёх
 *    автопопыток.
 * 2. GET /api/uploads сортировал без уникального вторичного ключа. При
 *    sort=status (и по любому другому неуникальному полю) порядок строк внутри
 *    группы равных значений не определён, поэтому постраничный обход дублирует
 *    одни строки и теряет другие.
 *
 * Тесты DB-free: prisma и h3-глобалы подменяются в globalThis (в server/**
 * они приходят из auto-import Nuxt), внешние модули — через vi.mock.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { parseSort, toOrderBy } from "~~/server/utils/list-sort"
import { MAX_UPLOAD_ATTEMPTS } from "~~/server/utils/upload-retry-policy"

/** Синхронизация публикации фабрики: управляемо падает по флагу теста. */
const syncFailure = { error: null as Error | null }

vi.mock("~~/server/utils/factory-publication", () => ({
  syncFactoryPublicationFromUpload: async () => {
    if (syncFailure.error) throw syncFailure.error
  },
}))

/** Результат заливки: по умолчанию успех. */
const adapterResult = {
  error: null as Error | null,
  platformPostId: "post-1",
  platformPostUrl: "https://example.test/post-1",
}

vi.mock("~~/server/utils/social/factory", () => ({
  getSocialAdapter: () => ({
    uploadVideo: async () => {
      if (adapterResult.error) throw adapterResult.error
      return {
        platformPostId: adapterResult.platformPostId,
        platformPostUrl: adapterResult.platformPostUrl,
      }
    },
  }),
}))

vi.mock("~~/server/utils/telegram/alerts", () => ({
  sendTelegramAlert: async () => {},
}))

const GLOBAL_KEYS = [
  "prisma",
  "decrypt",
  "defineEventHandler",
  "requireScopedAccess",
  "getQuery",
] as const

const saved = new Map<string, unknown>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!saved.has(name)) saved.set(name, holder[name])
  holder[name] = value
}

beforeEach(() => {
  vi.resetModules()
  syncFailure.error = null
  adapterResult.error = null
})

afterEach(() => {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const key of GLOBAL_KEYS) {
    if (saved.has(key)) holder[key] = saved.get(key)
  }
  saved.clear()
})

// --- Пайплайн загрузки -------------------------------------------------------

interface UploadState {
  id: number
  status: string
  attemptCount: number
  errorMessage: string | null
  lastAttemptAt: Date | null
  blockedByEnv: boolean
}

interface PipelineStand {
  row: UploadState
  updates: Array<Record<string, unknown>>
  failUpdateOnStatus: string | null
}

/**
 * Мини-прослойка вместо prisma: хранит одну строку Upload и применяет патчи так
 * же, как БД (в том числе `{ increment }`), чтобы в тесте можно было смотреть
 * на итоговый attemptCount, а не на список вызовов.
 */
function installPipelineStand(): PipelineStand {
  const stand: PipelineStand = {
    row: {
      id: 11,
      status: "pending",
      attemptCount: 0,
      errorMessage: null,
      lastAttemptAt: null,
      blockedByEnv: false,
    },
    updates: [],
    failUpdateOnStatus: null,
  }

  setGlobal("decrypt", (value: string) => `plain:${value}`)
  setGlobal("prisma", {
    upload: {
      findUnique: async () => ({
        ...stand.row,
        title: "Ролик про ремонт",
        description: "Описание",
        hashtags: ["#ремонт"],
        platformOptions: null,
        platformContainerId: null,
        platformPostId: null,
        platformPostUrl: null,
        video: {
          id: 42,
          format: "portrait",
          filePath: "C:/tmp/video.mp4",
          fileUrl: null,
          storageKey: null,
        },
        socialAccount: {
          id: 7,
          platform: "tiktok",
          displayName: "Reforma TT",
          platformUserId: "u-7",
          status: "active",
          accessToken: "enc-access",
          refreshToken: "enc-refresh",
          expiresAt: null,
        },
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        stand.updates.push(data)
        if (stand.failUpdateOnStatus && data.status === stand.failUpdateOnStatus) {
          throw new Error("соединение с БД потеряно")
        }
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in value) {
            const inc = (value as { increment: number }).increment
            stand.row.attemptCount += inc
            continue
          }
          ;(stand.row as unknown as Record<string, unknown>)[key] = value
        }
        return { ...stand.row }
      },
    },
    socialUploadAttempt: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 300, ...data }),
      update: async () => ({}),
    },
  })

  return stand
}

async function runPipeline(): Promise<void> {
  const mod = await import("~~/server/utils/upload-pipeline")
  await mod.runUploadPipeline(11)
}

describe("runUploadPipeline: попытка считается ровно один раз", () => {
  const savedFlag = process.env.ENABLE_SOCIAL_POSTING

  beforeEach(() => {
    process.env.ENABLE_SOCIAL_POSTING = "true"
  })

  afterEach(() => {
    if (savedFlag === undefined) delete process.env.ENABLE_SOCIAL_POSTING
    else process.env.ENABLE_SOCIAL_POSTING = savedFlag
  })

  it("падение после записи статуса uploading не удваивает attemptCount", async () => {
    const stand = installPipelineStand()
    // Строка uploading в БД уже записана, падает следующий шаг той же функции.
    syncFailure.error = new Error("фабрика публикаций недоступна")

    await runPipeline()

    expect(stand.row.status).toBe("failed")
    // Старое поведение: 2 — попытку считали и на шаге uploading, и в catch.
    expect(stand.row.attemptCount).toBe(1)
    const failedPatch = stand.updates.at(-1)!
    expect(failedPatch).not.toHaveProperty("attemptCount")
    // Автопопытки остаются: одна потрачена, две в запасе.
    expect(stand.row.attemptCount).toBeLessThan(MAX_UPLOAD_ATTEMPTS)
  })

  it("нормальный успешный прогон тратит одну попытку", async () => {
    const stand = installPipelineStand()

    await runPipeline()

    expect(stand.row.status).toBe("published")
    expect(stand.row.attemptCount).toBe(1)
  })

  it("ошибка платформы после успешного uploading тоже тратит одну попытку", async () => {
    const stand = installPipelineStand()
    adapterResult.error = new Error("платформа ответила 503")

    await runPipeline()

    expect(stand.row.status).toBe("failed")
    expect(stand.row.attemptCount).toBe(1)
    expect(String(stand.row.errorMessage)).toContain("503")
  })

  it("если запись uploading не прошла, попытку досчитывает обработчик ошибки", async () => {
    const stand = installPipelineStand()
    // В БД ничего не записалось — иначе автоповтор крутил бы загрузку без лимита.
    stand.failUpdateOnStatus = "uploading"

    await runPipeline()

    expect(stand.row.status).toBe("failed")
    expect(stand.row.attemptCount).toBe(1)
  })
})

// --- Список загрузок ---------------------------------------------------------

interface ListCall {
  orderBy: unknown
}

function installListStand(): ListCall {
  const call: ListCall = { orderBy: null }

  setGlobal("defineEventHandler", (fn: unknown) => fn)
  setGlobal("requireScopedAccess", async () => ({ id: 1 }))
  setGlobal("getQuery", (event: { query: Record<string, unknown> }) => event.query)
  setGlobal("parseSort", parseSort)
  setGlobal("toOrderBy", toOrderBy)
  setGlobal("prisma", {
    upload: {
      findMany: async (args: { orderBy: unknown }) => {
        call.orderBy = args.orderBy
        return []
      },
      count: async () => 0,
    },
  })

  return call
}

async function listUploads(query: Record<string, unknown>): Promise<ListCall> {
  const call = installListStand()
  const handler = (await import("~~/server/api/uploads/index.get")).default as unknown as (
    event: unknown,
  ) => Promise<unknown>
  await handler({ query })
  return call
}

describe("GET /api/uploads: детерминированный порядок страниц", () => {
  const cases = [
    { sort: undefined, field: "createdAt", direction: "desc" },
    { sort: "status", field: "status", direction: "asc" },
    { sort: "-status", field: "status", direction: "desc" },
    { sort: "scheduledAt", field: "scheduledAt", direction: "asc" },
    { sort: "-lastAttemptAt", field: "lastAttemptAt", direction: "desc" },
    { sort: "-updatedAt", field: "updatedAt", direction: "desc" },
    // Неизвестное поле молча падает на дефолт — tie-breaker всё равно нужен.
    { sort: "-somethingElse", field: "createdAt", direction: "desc" },
  ]

  for (const item of cases) {
    it(`sort=${item.sort ?? "(по умолчанию)"} → вторичный ключ id`, async () => {
      const call = await listUploads(item.sort ? { sort: item.sort } : {})

      expect(Array.isArray(call.orderBy)).toBe(true)
      const orderBy = call.orderBy as Array<Record<string, unknown>>
      expect(Object.keys(orderBy[0]!)).toEqual([item.field])
      // Уникальный ключ последним: без него порядок внутри равных значений
      // не определён и пагинация теряет строки.
      expect(orderBy.at(-1)).toEqual({ id: item.direction })
    })
  }

  it("nulls:last у дат сохраняется вместе с tie-breaker", async () => {
    const call = await listUploads({ sort: "-scheduledAt" })

    expect(call.orderBy).toEqual([
      { scheduledAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ])
  })
})
