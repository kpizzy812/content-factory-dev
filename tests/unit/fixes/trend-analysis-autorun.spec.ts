/**
 * Регрессия P0-2: трендвотчер импортировал ролики и на этом останавливался.
 *
 * По ТЗ (docs/SPEC.md, Модуль 1) выход агента — не сырой тренд, а БРИФ в базе
 * креативов: именно его потребляет Модуль 2. До фикса в trendwatcher-runner.ts
 * не было ни одного вызова анализа, статус `analyzing` не выставлялся никогда,
 * а `runTrendAnalyzer` звался ровно из одного места — ручной кнопки
 * POST /api/trends/[id]/analyze.
 *
 * Проверяем четыре свойства фикса:
 *   1. после импорта тренды реально получают CreativeBrief (прогон проходит
 *      через статус analyzing и пишет analyzedCount);
 *   2. идемпотентность — уже разобранный/разбираемый тренд не переанализируется;
 *   3. ограниченная пачка — импорт сотни роликов не превращается в лавину LLM;
 *   4. флаг платных API — при ENABLE_PAID_APIS != true разбора нет вовсе,
 *      а в mock-режиме он идёт по фикстуре без единого сетевого вызова.
 *
 * Сьюта чистая: ни БД, ни сети. Модули server/** ходят в prisma / apify-хелперы
 * / logAgent через auto-import Nuxt, поэтому фейки кладём в globalThis ДО
 * динамического импорта тестируемого модуля.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"

// ───────────────────────── подмена globals ─────────────────────────

const PATCHED_GLOBALS = [
  "prisma",
  "logAgent",
  "createError",
  "$fetch",
  "preflightValidateProfile",
  "runApifyActor",
  "getApifyResults",
  "getApifyRunInfo",
  "isInstagramScraperActor",
  "fetchAccountFollowers",
  "isImportableApifyItem",
  "mapApifyToTrend",
  "calcVirality",
] as const

const savedGlobals = new Map<string, unknown>()
const savedEnv = new Map<string, string | undefined>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!savedGlobals.has(name)) savedGlobals.set(name, holder[name])
  holder[name] = value
}

function setEnv(name: string, value: string | undefined): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const name of PATCHED_GLOBALS) {
    if (savedGlobals.has(name)) holder[name] = savedGlobals.get(name)
  }
  savedGlobals.clear()
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnv.clear()
})

// ───────────────────────── фейковая база ─────────────────────────

interface TrendRow {
  id: number
  platform: string
  title: string
  description: string | null
  authorName: string | null
  hashtags: string[]
  viewCount: number
  likeCount: number
  commentCount: number
  shareCount: number
  publishedAt: Date | null
  language: string | null
  geo: string | null
  thumbnailUrl: string | null
  sourceUrl: string
  isDeleted: boolean
  analysisStatus: string
  viralityScore: number | null
}

interface RunLogRow {
  level: string
  message: string
  step: string | null
}

function makeTrend(over: Partial<TrendRow> & { id: number }): TrendRow {
  return {
    platform: "tiktok",
    title: `Тренд ${over.id}`,
    description: null,
    authorName: null,
    hashtags: [],
    viewCount: 1000,
    likeCount: 10,
    commentCount: 1,
    shareCount: 0,
    publishedAt: null,
    language: "ru",
    geo: null,
    thumbnailUrl: null,
    sourceUrl: `https://tiktok.com/v/${over.id}`,
    isDeleted: false,
    analysisStatus: "none",
    viralityScore: null,
    ...over,
  }
}

interface FakeDb {
  trends: TrendRow[]
  briefs: Map<number, Record<string, unknown>>
  insights: Map<number, Record<string, unknown>>
  runLogs: RunLogRow[]
  runStatuses: string[]
  runData: Record<string, unknown>
  profile: Record<string, unknown> | null
}

type WhereClause = Record<string, unknown> | undefined

function matchTrend(row: TrendRow, where: WhereClause): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    const value = (row as unknown as Record<string, unknown>)[key]
    if (cond && typeof cond === "object" && "in" in (cond as Record<string, unknown>)) {
      const list = (cond as { in: unknown[] }).in
      if (!list.includes(value)) return false
      continue
    }
    if (value !== cond) return false
  }
  return true
}

/** Сортировка как в Postgres: desc с nulls last там, где так просит запрос. */
function sortTrends(rows: TrendRow[], orderBy: unknown): TrendRow[] {
  if (!Array.isArray(orderBy)) return rows
  const rules = orderBy as Array<Record<string, unknown>>
  return [...rows].sort((a, b) => {
    for (const rule of rules) {
      const [field, spec] = Object.entries(rule)[0]!
      const dir = typeof spec === "string" ? spec : (spec as { sort: string }).sort
      const nulls = typeof spec === "string" ? "first" : (spec as { nulls?: string }).nulls ?? "first"
      const av = (a as unknown as Record<string, unknown>)[field] as number | null
      const bv = (b as unknown as Record<string, unknown>)[field] as number | null
      if (av == null && bv == null) continue
      if (av == null) return nulls === "last" ? 1 : -1
      if (bv == null) return nulls === "last" ? -1 : 1
      if (av !== bv) return dir === "desc" ? bv - av : av - bv
    }
    return 0
  })
}

function createFakePrisma(db: FakeDb) {
  let nextTrendId = db.trends.reduce((max, t) => Math.max(max, t.id), 0) + 1

  return {
    trend: {
      findMany: async (args: { where?: WhereClause; orderBy?: unknown; take?: number; select?: unknown }) => {
        const found = sortTrends(db.trends.filter(t => matchTrend(t, args.where)), args.orderBy)
        const limited = typeof args.take === "number" ? found.slice(0, args.take) : found
        return limited.map(t => ({ ...t }))
      },
      findFirst: async (args: { where?: WhereClause }) => {
        const found = db.trends.find(t => matchTrend(t, args.where))
        return found ? { ...found } : null
      },
      findUnique: async (args: { where: { id: number } }) => {
        const found = db.trends.find(t => t.id === args.where.id)
        return found ? { ...found } : null
      },
      update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        const found = db.trends.find(t => t.id === args.where.id)
        if (!found) throw new Error(`trend ${args.where.id} not found`)
        Object.assign(found, args.data)
        return { ...found }
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const row = makeTrend({
          ...(args.data as Partial<TrendRow>),
          id: nextTrendId++,
        })
        db.trends.push(row)
        return { ...row }
      },
    },
    creativeBrief: {
      upsert: async (args: { where: { trendId: number }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = db.briefs.get(args.where.trendId)
        const next = existing ? { ...existing, ...args.update } : { ...args.create }
        db.briefs.set(args.where.trendId, next)
        return next
      },
    },
    trendInsight: {
      upsert: async (args: { where: { trendId: number }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = db.insights.get(args.where.trendId)
        const next = existing ? { ...existing, ...args.update } : { ...args.create }
        db.insights.set(args.where.trendId, next)
        return next
      },
    },
    trendwatcherRun: {
      update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        if (typeof args.data.status === "string") db.runStatuses.push(args.data.status)
        Object.assign(db.runData, args.data)
        return { id: args.where.id, ...db.runData }
      },
      findUnique: async () => ({ status: "running" }),
    },
    trendwatcherRunLog: {
      create: async (args: { data: RunLogRow }) => {
        db.runLogs.push({ level: args.data.level, message: args.data.message, step: args.data.step ?? null })
        return args.data
      },
    },
    trendwatcherProfile: {
      findUnique: async () => (db.profile ? { ...db.profile } : null),
      update: async (args: { data: Record<string, unknown> }) => {
        if (db.profile) Object.assign(db.profile, args.data)
        return db.profile
      },
    },
  }
}

function emptyDb(trends: TrendRow[] = []): FakeDb {
  return {
    trends,
    briefs: new Map(),
    insights: new Map(),
    runLogs: [],
    runStatuses: [],
    runData: {},
    profile: null,
  }
}

/** Базовая обвязка: prisma + логгеры + запрет сети. */
function installBaseGlobals(db: FakeDb): { networkCalls: string[] } {
  const networkCalls: string[] = []
  setGlobal("prisma", createFakePrisma(db))
  setGlobal("logAgent", async () => {})
  setGlobal("createError", (opts: { message?: string }) => new Error(opts?.message ?? "error"))
  setGlobal("$fetch", async (url: string) => {
    networkCalls.push(url)
    if (url.includes("api.apify.com")) return { data: { id: "ext-1", status: "SUCCEEDED" } }
    throw new Error(`Сеть в тесте запрещена: ${url}`)
  })
  return { networkCalls }
}

// ══════════════════ 1. Гейт платных API и mock-режима ══════════════════

describe("режим автоматического разбора трендов", () => {
  it("mock-режим важнее флага платных API, без него нужен ENABLE_PAID_APIS", async () => {
    const { resolveTrendAnalysisMode } = await import("~~/server/utils/agents/trend-analyzer-agent")

    expect(resolveTrendAnalysisMode({ ANTHROPIC_MOCK_MODE: "true" } as NodeJS.ProcessEnv)).toBe("mock")
    expect(resolveTrendAnalysisMode({ ENABLE_PAID_APIS: "true" } as NodeJS.ProcessEnv)).toBe("live")
    expect(resolveTrendAnalysisMode({} as NodeJS.ProcessEnv)).toBe("disabled")
    expect(resolveTrendAnalysisMode({ ENABLE_PAID_APIS: "false" } as NodeJS.ProcessEnv)).toBe("disabled")
  })

  it("при выключенных платных API не трогает ни одного тренда", async () => {
    setEnv("ANTHROPIC_MOCK_MODE", undefined)
    setEnv("ENABLE_PAID_APIS", undefined)

    const db = emptyDb([makeTrend({ id: 1 }), makeTrend({ id: 2 })])
    const { networkCalls } = installBaseGlobals(db)

    const { runTrendAutoAnalysis } = await import("~~/server/utils/agents/trend-analyzer-agent")
    const report = await runTrendAutoAnalysis({ trendIds: [1, 2] })

    expect(report.mode).toBe("disabled")
    expect(report.analyzed).toBe(0)
    expect(db.briefs.size).toBe(0)
    // Статусы трендов не двигались — «running» никто не выставлял.
    expect(db.trends.map(t => t.analysisStatus)).toEqual(["none", "none"])
    expect(networkCalls).toEqual([])
  })
})

// ══════════════════ 2. Отбор трендов: идемпотентность и пачка ══════════════════

describe("отбор трендов на разбор", () => {
  beforeEach(() => {
    setEnv("ANTHROPIC_MOCK_MODE", "true")
  })

  it("не переанализирует готовые, идущие и удалённые тренды", async () => {
    const db = emptyDb([
      makeTrend({ id: 1, analysisStatus: "completed" }),
      makeTrend({ id: 2, analysisStatus: "running" }),
      makeTrend({ id: 3, analysisStatus: "none" }),
      makeTrend({ id: 4, analysisStatus: "failed" }),
      makeTrend({ id: 5, analysisStatus: "none", isDeleted: true }),
    ])
    installBaseGlobals(db)

    const { selectTrendsForAnalysis } = await import("~~/server/utils/agents/trend-analyzer-agent")
    const selected = await selectTrendsForAnalysis([1, 2, 3, 4, 5], 10)

    expect(selected.sort()).toEqual([3, 4])
  })

  it("ограничивает пачку и берёт самые виральные", async () => {
    const trends = Array.from({ length: 40 }, (_, i) =>
      makeTrend({ id: i + 1, viralityScore: i + 1 }))
    const db = emptyDb(trends)
    installBaseGlobals(db)

    const { selectTrendsForAnalysis, TREND_AUTO_ANALYSIS_LIMIT } = await import(
      "~~/server/utils/agents/trend-analyzer-agent"
    )
    const ids = trends.map(t => t.id)

    // Лимит по умолчанию — небольшой, иначе сотня импортов = сотня LLM-запросов.
    expect(TREND_AUTO_ANALYSIS_LIMIT).toBeLessThanOrEqual(10)

    const selected = await selectTrendsForAnalysis(ids)
    expect(selected).toHaveLength(TREND_AUTO_ANALYSIS_LIMIT)
    expect(selected[0]).toBe(40)
  })
})

// ══════════════════ 3. Разбор пачки в mock-режиме ══════════════════

describe("разбор пачки трендов", () => {
  beforeEach(() => {
    setEnv("ANTHROPIC_MOCK_MODE", "true")
    setEnv("ENABLE_PAID_APIS", undefined)
  })

  it("кладёт бриф в базу и не делает сетевых вызовов", async () => {
    const db = emptyDb([
      makeTrend({ id: 1, viralityScore: 5 }),
      makeTrend({ id: 2, viralityScore: 4 }),
      makeTrend({ id: 3, analysisStatus: "completed", viralityScore: 9 }),
    ])
    const { networkCalls } = installBaseGlobals(db)

    const { runTrendAutoAnalysis } = await import("~~/server/utils/agents/trend-analyzer-agent")
    const report = await runTrendAutoAnalysis({ trendIds: [1, 2, 3], limit: 5 })

    expect(report.mode).toBe("mock")
    expect(report.analyzed).toBe(2)
    expect(report.failed).toBe(0)
    expect([...db.briefs.keys()].sort()).toEqual([1, 2])
    expect(db.insights.size).toBe(2)
    expect(db.trends.find(t => t.id === 1)?.analysisStatus).toBe("completed")
    // Уже разобранный тренд остался нетронутым.
    expect(db.briefs.has(3)).toBe(false)
    expect(networkCalls).toEqual([])

    const brief = db.briefs.get(1) as Record<string, unknown>
    expect(typeof brief.summary).toBe("string")
    expect((brief.summary as string).length).toBeGreaterThan(0)
    expect(brief.promptVersion).toBeTruthy()
  }, 20_000)

  it("повторный вызов на тех же трендах ничего не переанализирует", async () => {
    const db = emptyDb([makeTrend({ id: 1 })])
    installBaseGlobals(db)

    const { runTrendAutoAnalysis } = await import("~~/server/utils/agents/trend-analyzer-agent")
    const first = await runTrendAutoAnalysis({ trendIds: [1] })
    const second = await runTrendAutoAnalysis({ trendIds: [1] })

    expect(first.analyzed).toBe(1)
    expect(second.analyzed).toBe(0)
    expect(second.selected).toBe(0)
  }, 20_000)
})

// ══════════════════ 4. Главный регресс: прогон трендвотчера ══════════════════

describe("прогон трендвотчера", () => {
  beforeEach(() => {
    setEnv("ANTHROPIC_MOCK_MODE", "true")
    setEnv("ENABLE_PAID_APIS", undefined)
    setEnv("APIFY_TOKEN", "test-token")
  })

  /** Обвязка Apify: профиль валиден, актор отработал, dataset из N роликов. */
  function installApifyGlobals(db: FakeDb, itemCount: number): void {
    db.profile = {
      id: 7,
      appId: 1,
      enabled: true,
      keywords: ["питание"],
      platforms: ["tiktok"],
      language: "ru",
      geo: null,
      actorId: "clockworks/tiktok-scraper",
      maxItems: 50,
      contentFormat: null,
      viewCountMin: null,
      viewCountMax: null,
    }
    setGlobal("preflightValidateProfile", async () => ({ valid: true, canRetry: false, needsProfileFix: false }))
    setGlobal("runApifyActor", async () => "ext-1")
    setGlobal("getApifyResults", async () =>
      Array.from({ length: itemCount }, (_, i) => ({ webVideoUrl: `https://tiktok.com/v/${i + 1}` })))
    setGlobal("getApifyRunInfo", async () => null)
    setGlobal("isInstagramScraperActor", () => false)
    setGlobal("fetchAccountFollowers", async () => new Map())
    setGlobal("isImportableApifyItem", () => true)
    setGlobal("mapApifyToTrend", (item: Record<string, unknown>) => ({
      platform: "tiktok",
      sourceUrl: item.webVideoUrl,
      title: `Ролик ${item.webVideoUrl}`,
      viewCount: 10_000,
      hashtags: [],
      language: "ru",
    }))
    setGlobal("calcVirality", () => 2.5)
  }

  it("после импорта тренды получают бриф, а прогон проходит через analyzing", async () => {
    const db = emptyDb()
    const { networkCalls } = installBaseGlobals(db)
    installApifyGlobals(db, 2)

    const { executeTrendwatcherRun } = await import("~~/server/utils/trendwatcher-runner")
    await executeTrendwatcherRun({ runId: 100, profileId: 7 })

    // Импорт отработал как раньше.
    expect(db.trends).toHaveLength(2)
    // И — главное — у трендов появился бриф без ручного клика.
    expect(db.briefs.size).toBe(2)
    expect(db.trends.every(t => t.analysisStatus === "completed")).toBe(true)

    // Статус analyzing реально выставлен, счётчик разобранных заполнен.
    expect(db.runStatuses).toContain("analyzing")
    expect(db.runStatuses[db.runStatuses.length - 1]).toBe("completed")
    expect(db.runData.analyzedCount).toBe(2)

    // Никакой сети, кроме поллинга Apify.
    expect(networkCalls.every(url => url.includes("api.apify.com"))).toBe(true)
  }, 30_000)

  it("при выключенных платных API прогон завершается без фазы analyzing", async () => {
    setEnv("ANTHROPIC_MOCK_MODE", undefined)
    setEnv("ENABLE_PAID_APIS", undefined)

    const db = emptyDb()
    installBaseGlobals(db)
    installApifyGlobals(db, 2)

    const { executeTrendwatcherRun } = await import("~~/server/utils/trendwatcher-runner")
    await executeTrendwatcherRun({ runId: 101, profileId: 7 })

    expect(db.trends).toHaveLength(2)
    expect(db.briefs.size).toBe(0)
    expect(db.runStatuses).not.toContain("analyzing")
    expect(db.runStatuses[db.runStatuses.length - 1]).toBe("completed")
    expect(db.runLogs.some(l => l.message.includes("AI-анализ пропущен"))).toBe(true)
  }, 30_000)
})
