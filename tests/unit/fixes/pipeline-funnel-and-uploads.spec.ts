/**
 * Регрессии двух дефектов, из-за которых конвейер вёл себя не так, как обещал:
 *
 *   1. Сценарная нода конвейера не подтягивала воронку юнита. Ручной
 *      /api/scenarios/generate передавал генератору funnel, автопрогон — нет,
 *      поэтому автоматический CTA уезжал в «назови приложение и скачай» вместо
 *      кодового слова в директ (docs/PROJECT_CONTEXT.md §9).
 *   2. Планировщик загрузок один раз читал ENABLE_SOCIAL_POSTING на старте
 *      процесса, помечал плановые загрузки blocked_by_env — и больше к ним не
 *      возвращался. Упавшие загрузки не повторялись вовсе.
 *
 * Сьюта чистая: БД, сети и пайплайна тут нет. Модули server/** ходят в
 * prisma / logAgent / runUploadPipeline через auto-import Nuxt, поэтому фейки
 * кладём в globalThis ДО динамического импорта тестируемого модуля.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"

// ───────────────────────── общие хелперы ─────────────────────────

/** Ключи globalThis, которые тест подменяет и обязан вернуть на место. */
const PATCHED_GLOBALS = ["prisma", "logAgent", "generateScenarios", "runUploadPipeline"] as const

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

afterEach(() => {
  restoreGlobals()
})

// ══════════════════ 1. Воронка в appData сценарной ноды ══════════════════

/** Строка ContentFunnel в объёме, который нужен резолверу воронки. */
interface FunnelRow {
  id: string
  appId: number
  status: string
  keyword: string
  updatedAt: Date
  leadMagnet: { title: string } | null
}

const APP_ROW = {
  id: 42,
  name: "Реформа",
  description: "Юнит про питание",
  keywords: ["питание", "привычки"],
  language: "ru",
  transformationPromise: null,
  corePain: null,
  coreOutcome: null,
  creativeAngles: null,
  scenarioContext: null,
  referenceImageUrls: [],
}

const TREND_INPUT = {
  id: 11,
  title: "Тренд про завтраки",
  description: "Разбор утренней рутины",
  platform: "instagram",
  hashtags: ["#завтрак"],
  viewCount: 120_000,
  insights: [{ whyViral: "боль зрителя", patterns: ["до/после"], hooks: ["стоп"], audience: "женщины 25-35" }],
  brief: null,
}

/** Сигнал «нужное уже поймали» — дальше нода полезла бы в БД за сценариями. */
class CapturedAppData extends Error {
  constructor() {
    super("appData пойман, дальше нода не нужна")
  }
}

interface ScenarioNodeRun {
  appData: Record<string, unknown> | null
  logs: Array<{ level: string; message: string }>
  funnelQueries: Array<Record<string, unknown>>
}

/**
 * Прогоняет executeScenarioNode на фейковых глобалах и возвращает то, что нода
 * реально отдала генератору сценариев.
 */
async function runScenarioNode(
  funnels: FunnelRow[],
  factory?: Record<string, unknown>,
): Promise<ScenarioNodeRun> {
  const run: ScenarioNodeRun = { appData: null, logs: [], funnelQueries: [] }

  setGlobal("prisma", {
    app: {
      findUnique: async () => APP_ROW,
      findFirst: async () => APP_ROW,
    },
    contentFunnel: {
      // Повторяем семантику дефолтного lookup: только активные воронки юнита,
      // самая свежая по updatedAt, опционально сузить до конкретного id.
      findFirst: async (args: { where: Record<string, unknown> }) => {
        run.funnelQueries.push(args.where)
        const where = args.where as { appId: number; status: string; id?: string }
        const matched = funnels
          .filter(f => f.appId === where.appId && f.status === where.status)
          .filter(f => (where.id ? f.id === where.id : true))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        const row = matched[0]
        return row ? { id: row.id, keyword: row.keyword, leadMagnet: row.leadMagnet } : null
      },
    },
    scenario: { findFirst: async () => null },
    pipeline: { findUnique: async () => null },
    workflowRun: { findUnique: async () => null },
  })
  setGlobal("logAgent", async (_agent: string, level: string, message: string) => {
    run.logs.push({ level, message })
  })
  setGlobal("generateScenarios", async (_trend: unknown, appData: Record<string, unknown>) => {
    run.appData = appData
    throw new CapturedAppData()
  })

  const { executeScenarioNode } = await import("~~/server/utils/pipeline-executors")
  try {
    await executeScenarioNode(
      { app: { appId: APP_ROW.id }, variantsCount: 1, maxTrends: 1 },
      { trends: [TREND_INPUT], ...(factory ? { _factory: factory } : {}) },
    )
  } catch (err) {
    if (!(err instanceof CapturedAppData)) throw err
  }

  return run
}

const ACTIVE_FUNNEL: FunnelRow = {
  id: "funnel-active",
  appId: APP_ROW.id,
  status: "active",
  keyword: "РАЦИОН",
  updatedAt: new Date("2026-08-01T10:00:00.000Z"),
  leadMagnet: { title: "Гайд: 7 дней без срывов" },
}

const BATCH_FUNNEL: FunnelRow = {
  id: "funnel-batch",
  appId: APP_ROW.id,
  status: "active",
  keyword: "СТАРТ",
  updatedAt: new Date("2026-07-01T10:00:00.000Z"),
  leadMagnet: { title: "Чек-лист новичка" },
}

describe("сценарная нода конвейера: воронка в appData", () => {
  it("передаёт генератору воронку юнита в том же формате, что ручной эндпоинт", async () => {
    const run = await runScenarioNode([ACTIVE_FUNNEL])

    // Ровно то, что кладёт server/api/scenarios/generate.post.ts:
    // { keyword, leadMagnetTitle } и ничего сверх этого.
    expect(run.appData?.funnel).toEqual({
      keyword: "РАЦИОН",
      leadMagnetTitle: "Гайд: 7 дней без срывов",
    })
    // Автопрогон обязан спрашивать только активные воронки этого юнита.
    expect(run.funnelQueries).toContainEqual({ appId: APP_ROW.id, status: "active" })
  })

  it("берёт самую свежую активную воронку, а не первую попавшуюся", async () => {
    const run = await runScenarioNode([BATCH_FUNNEL, ACTIVE_FUNNEL])

    expect(run.appData?.funnel).toMatchObject({ keyword: "РАЦИОН" })
  })

  it("воронка партии фабрики важнее последней активной", async () => {
    const run = await runScenarioNode([ACTIVE_FUNNEL, BATCH_FUNNEL], {
      cycleId: 5,
      funnelId: BATCH_FUNNEL.id,
      assignments: [{ platform: "instagram", socialAccountId: 3 }],
    })

    expect(run.appData?.funnel).toEqual({
      keyword: "СТАРТ",
      leadMagnetTitle: "Чек-лист новичка",
    })
  })

  it("выключенную воронку партии не подставляет молча: падает на активную и предупреждает", async () => {
    const run = await runScenarioNode([ACTIVE_FUNNEL], {
      cycleId: 5,
      funnelId: "funnel-выключена",
      assignments: [],
    })

    expect(run.appData?.funnel).toMatchObject({ keyword: "РАЦИОН" })
    expect(run.logs.some(l => l.level === "warn" && l.message.includes("funnel-выключена"))).toBe(true)
  })

  it("без активной воронки кладёт funnel=null и предупреждает оператора", async () => {
    const run = await runScenarioNode([])

    // Именно null, а не undefined: генератор различает «воронки нет» и «поле
    // забыли передать» — во втором случае он уходил в CTA про приложение.
    expect(run.appData).not.toBeNull()
    expect(Object.hasOwn(run.appData!, "funnel")).toBe(true)
    expect(run.appData?.funnel).toBeNull()
    expect(run.logs.some(l => l.level === "warn" && l.message.includes("нет активной воронки"))).toBe(true)
  })

  it("не ломает остальной контекст юнита, который ждёт генератор", async () => {
    const run = await runScenarioNode([ACTIVE_FUNNEL])

    // Набор полей — контракт с generateScenarios, тот же, что у ручного пути.
    for (const key of [
      "name", "description", "keywords", "language",
      "transformationPromise", "corePain", "coreOutcome",
      "creativeAngles", "scenarioContext",
    ]) {
      expect(Object.hasOwn(run.appData!, key), key).toBe(true)
    }
    expect(run.appData?.name).toBe("Реформа")
  })
})

// ══════════════════ 2. Тик планировщика загрузок ══════════════════

interface UploadRow {
  id: number
  status: string
  scheduledAt: Date | null
  createdAt: Date
  attemptCount: number
  lastAttemptAt: Date | null
  errorMessage: string | null
  blockedByEnv: boolean
}

const NOW = new Date("2026-08-07T12:00:00.000Z")

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000)
}

function upload(row: Partial<UploadRow> & { id: number; status: string }): UploadRow {
  return {
    scheduledAt: null,
    createdAt: minutesAgo(600),
    attemptCount: 0,
    lastAttemptAt: null,
    errorMessage: null,
    blockedByEnv: false,
    ...row,
  }
}

interface UploadDbHandle {
  rows: UploadRow[]
  /** id, для которых реально дёрнули пайплайн публикации. */
  launched: number[]
  byId: (id: number) => UploadRow
  /** Хук «конкурент забрал запись» — вызывается перед каждым updateMany. */
  onBeforeUpdate: ((id: number) => void) | null
}

/**
 * Фейковая prisma.upload поверх массива: поддерживает ровно те формы запросов,
 * которыми пользуется тик (findMany по статусу + updateMany с проверкой статуса).
 */
function installUploadDb(rows: UploadRow[]): UploadDbHandle {
  const handle: UploadDbHandle = {
    rows,
    launched: [],
    byId: (id: number) => {
      const row = rows.find(r => r.id === id)
      if (!row) throw new Error(`В фейковой БД нет Upload #${id}`)
      return row
    },
    onBeforeUpdate: null,
  }

  setGlobal("prisma", {
    upload: {
      findMany: async (args: {
        where: Record<string, any>
        take?: number
        orderBy?: Record<string, string>
      }) => {
        const { where } = args
        const matched = rows.filter((row) => {
          if (where.status && row.status !== where.status) return false
          if (where.scheduledAt?.lte && (!row.scheduledAt || row.scheduledAt > where.scheduledAt.lte)) return false
          if (where.attemptCount?.lt !== undefined && !(row.attemptCount < where.attemptCount.lt)) return false
          return true
        })
        return matched.slice(0, args.take ?? matched.length).map(row => ({ ...row }))
      },
      updateMany: async (args: { where: Record<string, any>; data: Record<string, unknown> }) => {
        handle.onBeforeUpdate?.(args.where.id as number)
        const row = rows.find(r => r.id === args.where.id)
        if (!row) return { count: 0 }
        if (args.where.status && row.status !== args.where.status) return { count: 0 }
        Object.assign(row, args.data)
        return { count: 1 }
      },
    },
  })
  setGlobal("runUploadPipeline", async (id: number) => {
    handle.launched.push(id)
  })

  return handle
}

async function tick() {
  const { runUploadSchedulerTick } = await import("~~/server/utils/upload-scheduler")
  return runUploadSchedulerTick(NOW)
}

describe("тик планировщика загрузок", () => {
  const savedFlag = process.env.ENABLE_SOCIAL_POSTING

  beforeEach(() => {
    process.env.ENABLE_SOCIAL_POSTING = "true"
  })

  afterEach(() => {
    if (savedFlag === undefined) delete process.env.ENABLE_SOCIAL_POSTING
    else process.env.ENABLE_SOCIAL_POSTING = savedFlag
  })

  it("запускает плановую загрузку, у которой настало время", async () => {
    const db = installUploadDb([
      upload({ id: 1, status: "scheduled", scheduledAt: minutesAgo(5) }),
      upload({ id: 2, status: "scheduled", scheduledAt: new Date(NOW.getTime() + 60_000) }),
    ])

    const stats = await tick()

    expect(stats.started).toBe(1)
    expect(db.launched).toEqual([1])
    expect(db.byId(1).status).toBe("pending")
    expect(db.byId(2).status).toBe("scheduled")
  })

  it("при выключенном флаге блокирует плановые и обещает вернуть их сам", async () => {
    process.env.ENABLE_SOCIAL_POSTING = "false"
    const db = installUploadDb([upload({ id: 1, status: "scheduled", scheduledAt: minutesAgo(5) })])

    const stats = await tick()

    expect(stats.blocked).toBe(1)
    expect(stats.started).toBe(0)
    expect(db.launched).toEqual([])
    expect(db.byId(1).status).toBe("blocked_by_env")
    expect(db.byId(1).blockedByEnv).toBe(true)
    // Формулировка — часть контракта с оператором: возврат в очередь автоматический.
    expect(db.byId(1).errorMessage).toContain("автоматически")
  })

  it("после включения флага сам поднимает зависшие blocked_by_env", async () => {
    // Суть дефекта: раньше флаг читался один раз при старте процесса, и такие
    // записи не поднимал никто — обещание «вернётся в очередь» было ложью.
    const db = installUploadDb([
      upload({ id: 1, status: "scheduled", scheduledAt: minutesAgo(5) }),
    ])

    process.env.ENABLE_SOCIAL_POSTING = "false"
    await tick()
    expect(db.byId(1).status).toBe("blocked_by_env")

    process.env.ENABLE_SOCIAL_POSTING = "true"
    const second = await tick()

    expect(second.resumed).toBe(1)
    expect(db.byId(1).status).toBe("pending")
    expect(db.byId(1).blockedByEnv).toBe(false)
    expect(db.byId(1).errorMessage).toBeNull()
    expect(db.launched).toEqual([1])
  })

  it("разблокированную отложенную публикацию возвращает в расписание, а не публикует раньше времени", async () => {
    const db = installUploadDb([
      upload({
        id: 1,
        status: "blocked_by_env",
        blockedByEnv: true,
        scheduledAt: new Date(NOW.getTime() + 30 * 60_000),
      }),
    ])

    const stats = await tick()

    expect(stats.rescheduled).toBe(1)
    expect(stats.resumed).toBe(0)
    expect(db.byId(1).status).toBe("scheduled")
    expect(db.launched).toEqual([])
  })

  it("повторяет упавшую по сетевой причине загрузку, когда backoff выдержан", async () => {
    const db = installUploadDb([
      upload({
        id: 1,
        status: "failed",
        attemptCount: 1,
        lastAttemptAt: minutesAgo(30),
        errorMessage: "fetch failed",
      }),
    ])

    const stats = await tick()

    expect(stats.retried).toBe(1)
    expect(db.byId(1).status).toBe("pending")
    expect(db.byId(1).errorMessage).toBeNull()
    expect(db.launched).toEqual([1])
  })

  it("не повторяет то, что повтором не чинится: нет OAuth и выключенный аккаунт", async () => {
    const db = installUploadDb([
      upload({
        id: 1,
        status: "failed",
        attemptCount: 1,
        lastAttemptAt: minutesAgo(120),
        errorMessage: "Аккаунт Reforma IG не подключён через официальный OAuth. Переподключите аккаунт.",
      }),
      upload({
        id: 2,
        status: "failed",
        attemptCount: 1,
        lastAttemptAt: minutesAgo(120),
        errorMessage: "Аккаунт Reforma IG неактивен (expired)",
      }),
      upload({
        id: 3,
        status: "failed",
        attemptCount: 1,
        lastAttemptAt: minutesAgo(2),
        errorMessage: "socket hang up",
      }),
    ])

    const stats = await tick()

    expect(stats.retried).toBe(0)
    // Все трое пропущены: двое терминально, третий ещё выдерживает паузу.
    expect(stats.skipped).toBe(3)
    expect(db.launched).toEqual([])
    expect(db.rows.map(r => r.status)).toEqual(["failed", "failed", "failed"])
  })

  it("исчерпавшую попытки загрузку не трогает — дальше нужен человек", async () => {
    const { MAX_UPLOAD_ATTEMPTS } = await import("~~/server/utils/upload-retry-policy")
    const db = installUploadDb([
      upload({
        id: 1,
        status: "failed",
        attemptCount: MAX_UPLOAD_ATTEMPTS,
        lastAttemptAt: minutesAgo(600),
        errorMessage: "fetch failed",
      }),
    ])

    const stats = await tick()

    expect(stats.retried).toBe(0)
    expect(db.launched).toEqual([])
    expect(db.byId(1).status).toBe("failed")
  })

  it("не запускает загрузку дважды, если её успел забрать другой тик", async () => {
    const db = installUploadDb([upload({ id: 1, status: "scheduled", scheduledAt: minutesAgo(5) })])
    // Эмулируем конкурента: между выборкой и захватом статус уже сменили.
    db.onBeforeUpdate = (id) => {
      if (id === 1) db.byId(1).status = "uploading"
    }

    const stats = await tick()

    expect(stats.started).toBe(0)
    expect(db.launched).toEqual([])
    expect(db.byId(1).status).toBe("uploading")
  })

  it("при выключенном флаге не поднимает ни blocked_by_env, ни упавшие", async () => {
    process.env.ENABLE_SOCIAL_POSTING = "false"
    const db = installUploadDb([
      upload({ id: 1, status: "blocked_by_env", blockedByEnv: true }),
      upload({ id: 2, status: "failed", attemptCount: 1, lastAttemptAt: minutesAgo(120), errorMessage: "fetch failed" }),
    ])

    const stats = await tick()

    expect(stats.resumed).toBe(0)
    expect(stats.retried).toBe(0)
    expect(db.launched).toEqual([])
    expect(db.byId(1).status).toBe("blocked_by_env")
    expect(db.byId(2).status).toBe("failed")
  })
})
