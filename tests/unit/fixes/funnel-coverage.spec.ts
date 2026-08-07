/**
 * Регрессия P1-3: два входа рождали сценарий без воронки.
 *
 * resolveScenarioFunnel был подключён в ручной генерации и в сценарной ноде
 * конвейера, но мимо него шли ещё два пути:
 *   1. POST /api/ideas/:id/to-scenario — сценарий из идеи уходил в
 *      generateScenarios без поля funnel, и генератор с валидатором требовали
 *      «назови приложение и скажи скачай».
 *   2. runScenarioGenerationForScene — scene-scripter получал жёсткие правила
 *      «hook упоминает имя приложения» и «CTA — глагол + имя приложения».
 * Оба — против docs/PROJECT_CONTEXT.md §9, где конверсия идёт через кодовое
 * слово в директ, а зритель ничего не устанавливает.
 *
 * Сьюта чистая: ни БД, ни сети. Модули server/** ходят в prisma / logAgent и
 * прочие хелперы Nuxt через auto-import, поэтому фейки кладём в globalThis до
 * динамического импорта тестируемого модуля, а внешние модули (генератор
 * сценариев, вызов Anthropic) подменяем vi.mock.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// ───────────────────────── фикстуры внешних модулей ─────────────────────────

/** Общее состояние фабрик vi.mock — они поднимаются выше объявлений. */
const mocked = vi.hoisted(() => ({
  /** appData, с которым путь «идея → сценарий» позвал генератор. */
  ideaAppData: null as Record<string, unknown> | null,
  /** Промпты, с которыми scene-driven путь позвал сценариста. */
  scripterPrompts: null as { systemPrompt: string; userPrompt: string } | null,
}))

/** Сигнал «нужное уже поймали»: дальше путь полез бы в БД писать варианты. */
class Captured extends Error {
  constructor() {
    super("вход отдал то, что проверяем — дальше идти не нужно")
  }
}

vi.mock("../../../server/utils/anthropic", () => ({
  generateScenarios: async (_trend: unknown, appData: Record<string, unknown>) => {
    mocked.ideaAppData = appData
    throw new Captured()
  },
}))

vi.mock("../../../server/utils/agents/call-anthropic", () => ({
  callAnthropicAgent: async (options: { systemPrompt: string; userPrompt: string }) => {
    mocked.scripterPrompts = { systemPrompt: options.systemPrompt, userPrompt: options.userPrompt }
    throw new Captured()
  },
}))

// ───────────────────────── фейковые глобалы Nuxt ─────────────────────────

const PATCHED_GLOBALS = [
  "prisma",
  "logAgent",
  "defineEventHandler",
  "requireScopedAccess",
  "requirePaidApisEnabled",
  "getRouterParam",
  "readBody",
  "createError",
] as const

const savedGlobals = new Map<string, unknown>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!savedGlobals.has(name)) savedGlobals.set(name, holder[name])
  holder[name] = value
}

function restoreGlobals(): void {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const name of PATCHED_GLOBALS) {
    if (savedGlobals.has(name)) holder[name] = savedGlobals.get(name)
  }
  savedGlobals.clear()
}

/** Строка ContentFunnel в объёме, который нужен резолверу воронки. */
interface FunnelRow {
  id: string
  appId: number
  status: string
  keyword: string
  updatedAt: Date
  leadMagnet: { title: string } | null
}

const APP_ID = 42

const ACTIVE_FUNNEL: FunnelRow = {
  id: "funnel-active",
  appId: APP_ID,
  status: "active",
  keyword: "РАЦИОН",
  updatedAt: new Date("2026-08-01T10:00:00.000Z"),
  leadMagnet: { title: "Гайд: 7 дней без срывов" },
}

const BATCH_FUNNEL: FunnelRow = {
  id: "funnel-batch",
  appId: APP_ID,
  status: "active",
  keyword: "СТАРТ",
  updatedAt: new Date("2026-07-01T10:00:00.000Z"),
  leadMagnet: { title: "Чек-лист новичка" },
}

interface FunnelStore {
  queries: Array<Record<string, unknown>>
  logs: Array<{ module: string; level: string; message: string }>
}

/**
 * Повторяет семантику дефолтного lookup резолвера: только активные воронки
 * юнита, самая свежая по updatedAt, опционально сузить до конкретного id.
 */
function funnelFindFirst(funnels: FunnelRow[], store: FunnelStore) {
  return async (args: { where: Record<string, unknown> }) => {
    store.queries.push(args.where)
    const where = args.where as { appId: number; status: string; id?: string }
    const matched = funnels
      .filter(f => f.appId === where.appId && f.status === where.status)
      .filter(f => (where.id ? f.id === where.id : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    const row = matched[0]
    return row ? { id: row.id, keyword: row.keyword, leadMagnet: row.leadMagnet } : null
  }
}

function installLogAgent(store: FunnelStore): void {
  setGlobal("logAgent", async (module: string, level: string, message: string) => {
    store.logs.push({ module, level, message })
  })
}

beforeEach(() => {
  mocked.ideaAppData = null
  mocked.scripterPrompts = null
})

afterEach(() => {
  restoreGlobals()
})

// ══════════════════ 1. Идея → сценарий ══════════════════

const IDEA_ROW = {
  id: 5,
  appId: APP_ID,
  isDeleted: false,
  status: "ready",
  platform: "instagram",
  sourceUrl: "https://www.instagram.com/reel/1",
  title: "Три ошибки в рационе",
  body: "Разбор частых ошибок",
  hook: "Ты делаешь это каждый день",
  cta: null as string | null,
  whyViral: "Боль знакома аудитории",
  analysis: null,
  app: {
    id: APP_ID,
    name: "Реформа",
    description: "Юнит про питание",
    keywords: ["питание", "привычки"],
    language: "ru",
  },
}

interface IdeaRun {
  appData: Record<string, unknown> | null
  store: FunnelStore
}

/** Прогоняет POST /api/ideas/:id/to-scenario на фейковых глобалах. */
async function runIdeaToScenario(funnels: FunnelRow[], idea = IDEA_ROW): Promise<IdeaRun> {
  const store: FunnelStore = { queries: [], logs: [] }

  setGlobal("prisma", {
    idea: {
      findUnique: async () => idea,
      update: async () => idea,
    },
    contentFunnel: { findFirst: funnelFindFirst(funnels, store) },
    trend: { create: async () => ({ id: 11 }) },
    creativeBrief: { create: async () => ({ id: 21 }) },
    scenario: {
      create: async () => ({ id: 99 }),
      update: async () => ({ id: 99 }),
    },
    ideaOperatorAction: { create: async () => ({ id: 1 }) },
    $transaction: async (arg: unknown) =>
      typeof arg === "function" ? (arg as (tx: unknown) => unknown)({}) : arg,
  })
  installLogAgent(store)
  setGlobal("defineEventHandler", (handler: unknown) => handler)
  setGlobal("requireScopedAccess", async () => ({ id: 1 }))
  setGlobal("requirePaidApisEnabled", () => {})
  setGlobal("getRouterParam", () => String(idea.id))
  setGlobal("readBody", async () => ({ variantsCount: 1 }))
  setGlobal("createError", (opts: { message?: string }) =>
    Object.assign(new Error(opts?.message ?? "error"), opts))

  const previousKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = "test-key"
  try {
    const mod = await import("../../../server/api/ideas/[id]/to-scenario.post")
    const handler = mod.default as (event: unknown) => Promise<unknown>
    await handler({})
  } catch (err) {
    if (!(err instanceof Captured)) throw err
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previousKey
  }

  return { appData: mocked.ideaAppData, store }
}

describe("идея → сценарий: воронка доходит до генератора", () => {
  it("передаёт активную воронку юнита в том же формате, что остальные входы", async () => {
    const run = await runIdeaToScenario([ACTIVE_FUNNEL])

    // Ровно то, что кладут ручной эндпоинт и сценарная нода конвейера:
    // { keyword, leadMagnetTitle } и ничего сверх этого.
    expect(run.appData?.funnel).toEqual({
      keyword: "РАЦИОН",
      leadMagnetTitle: "Гайд: 7 дней без срывов",
    })
    // Спрашиваем только активные воронки этого юнита.
    expect(run.store.queries).toContainEqual({ appId: APP_ID, status: "active" })
  })

  it("берёт самую свежую активную воронку, а не первую попавшуюся", async () => {
    const run = await runIdeaToScenario([BATCH_FUNNEL, ACTIVE_FUNNEL])

    expect(run.appData?.funnel).toMatchObject({ keyword: "РАЦИОН" })
  })

  it("без активной воронки кладёт funnel=null и предупреждает оператора", async () => {
    const run = await runIdeaToScenario([])

    // Именно null, а не undefined: генератор различает «воронки нет» и «поле
    // забыли передать» — во втором случае он уходил в CTA про приложение.
    expect(run.appData).not.toBeNull()
    expect(Object.hasOwn(run.appData!, "funnel")).toBe(true)
    expect(run.appData?.funnel).toBeNull()
    expect(run.store.logs.some(l => l.level === "warn" && l.message.includes("нет активной воронки"))).toBe(true)
  })

  it("не ломает остальной контекст юнита, который ждёт генератор", async () => {
    const run = await runIdeaToScenario([ACTIVE_FUNNEL])

    for (const key of ["name", "description", "keywords", "language"]) {
      expect(Object.hasOwn(run.appData!, key), key).toBe(true)
    }
    expect(run.appData?.name).toBe("Реформа")
    expect(run.appData?.language).toBe("ru")
  })

  it("идея без привязанного юнита всё равно отдаёт поле funnel", async () => {
    const run = await runIdeaToScenario([ACTIVE_FUNNEL], { ...IDEA_ROW, app: null as never })

    expect(run.appData?.name).toBe("Приложение")
    expect(run.appData?.funnel).toMatchObject({ keyword: "РАЦИОН" })
  })
})

// ══════════════════ 2. Сцена → сценарий ══════════════════

const APP_ROW = {
  id: APP_ID,
  name: "Реформа",
  description: "Юнит про питание",
  keywords: ["питание", "привычки"],
  language: "ru",
  transformationPromise: null,
  corePain: null,
  coreOutcome: null,
}

interface SceneRun {
  prompts: { systemPrompt: string; userPrompt: string } | null
  store: FunnelStore
}

/** Прогоняет runScenarioGenerationForScene на фейковых глобалах. */
async function runSceneScenario(funnels: FunnelRow[], funnelId?: string): Promise<SceneRun> {
  const store: FunnelStore = { queries: [], logs: [] }

  setGlobal("prisma", {
    app: { findUnique: async () => APP_ROW },
    contentFunnel: { findFirst: funnelFindFirst(funnels, store) },
    appReferenceImage: { findUnique: async () => null },
  })
  installLogAgent(store)

  const { runScenarioGenerationForScene } = await import("../../../server/utils/scene-driven-scenario")
  try {
    await runScenarioGenerationForScene({
      appId: APP_ID,
      sceneId: "scene-1",
      sceneName: "Утро на кухне",
      compiledPrompt: "woman cooking breakfast, warm morning light",
      ...(funnelId ? { funnelId } : {}),
    })
  } catch (err) {
    if (!(err instanceof Captured)) throw err
  }

  return { prompts: mocked.scripterPrompts, store }
}

describe("сцена → сценарий: воронка доходит до сценариста", () => {
  it("с активной воронкой требует кодовое слово, а не имя приложения", async () => {
    const run = await runSceneScenario([ACTIVE_FUNNEL])

    expect(run.prompts).not.toBeNull()
    const all = `${run.prompts!.systemPrompt}\n${run.prompts!.userPrompt}`

    // Кодовое слово доехало до промптов — иначе CTA не приведёт лид в директ.
    expect(all).toContain("РАЦИОН")
    expect(all).toContain("Гайд: 7 дней без срывов")
    // И это не осталось декорацией: старое жёсткое требование снято.
    expect(run.prompts!.systemPrompt).not.toContain("CTA — глагол + имя приложения")
    expect(run.prompts!.systemPrompt).not.toContain("Hook ОБЯЗАТЕЛЬНО упоминает имя приложения")

    expect(run.store.queries).toContainEqual({ appId: APP_ID, status: "active" })
  })

  it("воронка партии фабрики важнее последней активной", async () => {
    const run = await runSceneScenario([ACTIVE_FUNNEL, BATCH_FUNNEL], BATCH_FUNNEL.id)

    const all = `${run.prompts!.systemPrompt}\n${run.prompts!.userPrompt}`
    expect(all).toContain("СТАРТ")
    expect(all).not.toContain("РАЦИОН")
  })

  it("выключенную воронку партии не подставляет молча: падает на активную и предупреждает", async () => {
    const run = await runSceneScenario([ACTIVE_FUNNEL], "funnel-выключена")

    const all = `${run.prompts!.systemPrompt}\n${run.prompts!.userPrompt}`
    expect(all).toContain("РАЦИОН")
    expect(run.store.logs.some(l => l.level === "warn" && l.message.includes("funnel-выключена"))).toBe(true)
  })

  it("без активной воронки работает как раньше: CTA про приложение + предупреждение", async () => {
    const run = await runSceneScenario([])

    expect(run.prompts).not.toBeNull()
    expect(run.prompts!.systemPrompt).toContain("CTA — глагол + имя приложения")
    expect(run.prompts!.systemPrompt).toContain("Hook ОБЯЗАТЕЛЬНО упоминает имя приложения")
    expect(run.store.logs.some(l => l.level === "warn" && l.message.includes("нет активной воронки"))).toBe(true)
  })
})
