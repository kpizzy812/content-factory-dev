/**
 * Регрессия: POST /api/posting-jobs заводил невыполнимую задачу.
 *
 * Очередь PostingJob обслуживает только browser_automation — на api-аккаунте
 * воркер терминально падает с ApiPostingUnsupportedError. Раньше отказ был
 * только для instagram/tiktok, поэтому youtube с postingMethod=api спокойно
 * получал job, который не мог выполниться никогда.
 *
 * Тест DB-free: обработчик дёргается напрямую, h3-глобалы и prisma подменяются
 * в globalThis (в server/** они приходят из auto-import Nuxt). Интеграционная
 * версия живёт в tests/api/posting-jobs-api-method-block.spec.ts.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// Гуард 1:1:1 ходит в БД и к делу не относится — в чистой сьюте он не нужен.
vi.mock("~~/server/utils/accounts/one-to-one-guard", () => ({
  assertOneToOneForBrowserAutomation: async () => {},
}))

/** Ошибка h3: createError кидает объект со statusCode/statusMessage/data. */
class FakeHttpError extends Error {
  statusCode: number
  statusMessage?: string
  data?: Record<string, unknown>

  constructor(params: { statusCode?: number, statusMessage?: string, message?: string, data?: Record<string, unknown> }) {
    super(params.message ?? params.statusMessage ?? "ошибка")
    this.statusCode = params.statusCode ?? 500
    this.statusMessage = params.statusMessage
    this.data = params.data
  }
}

interface AccountRow {
  id: number
  platform: string
  status: string
  displayName: string
  proxyId: number | null
  deviceProfileId: number | null
  postingMethod: string
  proxy: { id: number, status: string } | null
}

const GLOBAL_KEYS = [
  "defineEventHandler",
  "requireScopedAccess",
  "readBody",
  "createError",
  "setResponseStatus",
  "prisma",
  "createPostingJob",
  "defaultMaxAttemptsForMethod",
] as const

const saved = new Map<string, unknown>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!saved.has(name)) saved.set(name, holder[name])
  holder[name] = value
}

/** Джобы, созданные обработчиком за тест: пусто = отказ сработал до записи. */
let createdJobs: Array<Record<string, unknown>> = []

function installHandlerGlobals(account: AccountRow): void {
  createdJobs = []
  setGlobal("defineEventHandler", (fn: unknown) => fn)
  setGlobal("requireScopedAccess", async () => ({ id: 1 }))
  setGlobal("readBody", async (event: { body: unknown }) => event.body)
  setGlobal("createError", (params: ConstructorParameters<typeof FakeHttpError>[0]) => new FakeHttpError(params))
  setGlobal("setResponseStatus", () => {})
  setGlobal("prisma", {
    video: { findUnique: async () => ({ id: 77 }) },
    socialAccount: { findUnique: async () => account },
  })
  setGlobal("createPostingJob", async (data: Record<string, unknown>) => {
    createdJobs.push(data)
    return { id: 900 + createdJobs.length, ...data }
  })
  setGlobal("defaultMaxAttemptsForMethod", () => 5)
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const key of GLOBAL_KEYS) {
    if (saved.has(key)) holder[key] = saved.get(key)
  }
  saved.clear()
})

function account(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: 5,
    platform: "instagram",
    status: "active",
    displayName: "Reforma IG",
    proxyId: 3,
    deviceProfileId: 4,
    postingMethod: "api",
    proxy: { id: 3, status: "healthy" },
    ...overrides,
  }
}

/** Валидный snapshot для каждой площадки — иначе споткнёмся о валидацию раньше нужного. */
function snapshotFor(platform: string): Record<string, unknown> {
  if (platform === "youtube") {
    return {
      title: "Тест",
      description: "Описание",
      hashtags: ["#тест"],
      youtube: { visibility: "private", madeForKids: false },
    }
  }
  return { caption: "Подпись", hashtags: ["#тест"] }
}

async function callHandler(row: AccountRow) {
  // Глобалы ставим ДО импорта: defineEventHandler нужен уже на разборе модуля.
  installHandlerGlobals(row)
  const handler = (await import("~~/server/api/posting-jobs/index.post")).default as unknown as (
    event: unknown,
  ) => Promise<unknown>
  return handler({
    body: {
      videoId: 77,
      socialAccountId: row.id,
      platform: row.platform,
      contentSnapshot: snapshotFor(row.platform),
    },
  })
}

describe("POST /api/posting-jobs: аккаунт с официальным API", () => {
  for (const platform of ["instagram", "tiktok", "youtube"]) {
    it(`${platform} + postingMethod=api → отказ, джоба не создаётся`, async () => {
      const err = await callHandler(account({ platform, postingMethod: "api" })).catch(e => e)

      expect(err).toBeInstanceOf(FakeHttpError)
      expect(err.statusCode).toBe(422)
      expect(err.statusMessage).toBe("api_method_unsupported")
      expect(err.data).toMatchObject({ code: "api_method_unsupported", accountId: 5, platform })
      // Главное: невыполнимая задача не попала в очередь.
      expect(createdJobs).toHaveLength(0)
    })
  }

  it("объясняет оператору рабочий путь публикации, а не только запрет", async () => {
    const err = await callHandler(account({ platform: "youtube", postingMethod: "api" })).catch(e => e)

    expect(err.message).toContain("/api/uploads/create")
    expect(String(err.data?.suggestion)).toContain("/api/uploads/create")
  })

  it("browser_automation по-прежнему создаёт джобу", async () => {
    const result = await callHandler(account({ postingMethod: "browser_automation" })) as { data: unknown }

    expect(createdJobs).toHaveLength(1)
    expect(createdJobs[0]).toMatchObject({ videoId: 77, socialAccountId: 5, platform: "instagram" })
    expect(result.data).toBeTruthy()
  })

  it("прокси-гейт жёстче: без прокси api-аккаунт получает 412, а не 400", async () => {
    const err = await callHandler(
      account({ postingMethod: "api", proxyId: null, proxy: null }),
    ).catch(e => e)

    expect(err.statusCode).toBe(412)
    expect(err.statusMessage).toBe("no_proxy")
    expect(createdJobs).toHaveLength(0)
  })

  it("нездоровый прокси тоже приоритетнее отказа по методу", async () => {
    const err = await callHandler(
      account({ postingMethod: "api", proxy: { id: 3, status: "unhealthy" } }),
    ).catch(e => e)

    expect(err.statusCode).toBe(412)
    expect(err.statusMessage).toBe("proxy_unhealthy")
  })
})
