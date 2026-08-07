/**
 * Два хвоста legacy-оркестратора циклов (server/utils/cycle-orchestrator.ts) —
 * того самого пути, за которым стоит кнопка «запустить цикл» в админке:
 *
 *   1. Шаг «сценарии» звал generateScenarios вообще без воронки. Это был
 *      ЧЕТВЁРТЫЙ вход генерации (после сценарной ноды конвейера, ручного
 *      эндпоинта и пути из идеи), и единственный, который воронку не передавал:
 *      сценарий выходил без кодового слова, а генератор уходил в ветку «назови
 *      приложение и скажи скачай» — прямое расхождение с docs/PROJECT_CONTEXT.md §9.
 *   2. Шаг «загрузки» выбирал вариант сценария запросом
 *      `where: { status: 'accepted' }, take: 1`. Остальной код давно перешёл на
 *      общее правило selectScenarioVariantForVideo, которое уважает выбор
 *      оператора (Scenario.selectedVariantId) и жёсткую привязку Video.variantId.
 *      Из-за расхождения подпись к публикации уезжала от того варианта, по
 *      которому реально собран ролик.
 *
 * Сьюта чистая: ни БД, ни сети, ни платных вызовов. prisma/logAgent и прочие
 * auto-import'ы Nuxt подменяются в globalThis до вызова оркестратора.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { startCycle } from "~~/server/utils/cycle-orchestrator"

vi.mock("~~/server/utils/telegram/alerts", () => ({
  sendTelegramAlert: async () => ({ delivered: false }),
}))

// Критик — отдельный контур со своими платными вызовами; здесь он не проверяется.
vi.mock("~~/server/utils/scenario-critic-orchestrator", () => ({
  runQualityCriticForScenario: async () => ({ skipped: true }),
}))

// ───────────────────────── подмена auto-import'ов ─────────────────────────

const PATCHED_GLOBALS = [
  "prisma",
  "logAgent",
  "generateScenarios",
  "runVideoPipeline",
  "cancelVideoPipeline",
  "runUploadPipeline",
  "runApifyActor",
  "waitForApifyRun",
  "getApifyResults",
  "abortApifyRun",
] as const

/** Что лежало в globalThis до нас: undefined и «ключа не было» — разные вещи. */
const savedGlobals = new Map<string, { present: boolean, value: unknown }>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!savedGlobals.has(name)) {
    savedGlobals.set(name, { present: name in holder, value: holder[name] })
  }
  holder[name] = value
}

function restoreGlobals(): void {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const name of PATCHED_GLOBALS) {
    const saved = savedGlobals.get(name)
    if (!saved) continue
    if (saved.present) holder[name] = saved.value
    else delete holder[name]
  }
  savedGlobals.clear()
}

// ───────────────────────── общий стенд ─────────────────────────

const CYCLE_ID = 501
const APP_ID = 42

interface FunnelRow {
  id: string
  appId: number
  status: string
  keyword: string
  updatedAt: Date
  leadMagnet: { title: string } | null
}

interface VariantRow {
  id: number
  scenarioId: number
  variantIndex: number
  status: string
  isDeleted: boolean
  title: string
  hook: string
}

interface ScenarioRow {
  id: number
  selectedVariantId: number | null
  variants: VariantRow[]
  trend: { hashtags: string[] } | null
}

interface VideoRow {
  id: number
  variantId: number | null
  scenario: ScenarioRow
}

interface Stand {
  /** appData, которую шаг «сценарии» отдал генератору. */
  appData: Record<string, unknown> | null
  logs: Array<{ level: string, message: string }>
  /** Созданные шагом «загрузки» Upload — по ним видно выбранный вариант. */
  uploads: Array<Record<string, unknown>>
  funnels: FunnelRow[]
  /** Тренды для шага 2 (шаг 1 всегда пустой — Apify в тесте не нужен). */
  scenarioTrends: Array<Record<string, unknown>>
  videos: VideoRow[]
  cycleStatus: string
}

function createStand(): Stand {
  return {
    appData: null,
    logs: [],
    uploads: [],
    funnels: [],
    scenarioTrends: [],
    videos: [],
    cycleStatus: "pending",
  }
}

/**
 * Повторяет фильтрацию вложенного include для variants. Ключевой момент теста:
 * старый код просил `where: { status: 'accepted' }, take: 1`, и фейк обязан это
 * уважать — иначе тест не покраснел бы на старом поведении.
 */
function applyVariantsInclude(
  variants: VariantRow[],
  include: { where?: { status?: string }, take?: number, orderBy?: unknown } | true | undefined,
): VariantRow[] {
  const sorted = [...variants].sort((a, b) => a.variantIndex - b.variantIndex)
  if (!include || include === true) return sorted
  const filtered = include.where?.status
    ? sorted.filter(v => v.status === include.where!.status)
    : sorted
  return typeof include.take === "number" ? filtered.slice(0, include.take) : filtered
}

function createFakePrisma(stand: Stand): Record<string, unknown> {
  return {
    productionCycle: {
      findUnique: async ({ where, select }: { where: { id: number }, select?: Record<string, boolean> }) => {
        if (where.id !== CYCLE_ID) return null
        if (select?.status) return { status: stand.cycleStatus }
        if (select?.completedAt) return { completedAt: null }
        return {
          id: CYCLE_ID,
          appId: APP_ID,
          groupId: 1,
          status: stand.cycleStatus,
          app: { id: APP_ID, name: "Реформа", description: "Юнит про питание", keywords: ["привычки"], language: "ru" },
          accountGroup: { members: [{ socialAccountId: 7 }] },
        }
      },
      update: async () => ({ id: CYCLE_ID }),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.status === "string") stand.cycleStatus = data.status
        return { count: 1 }
      },
    },

    trend: {
      // Шаг 1 спрашивает `status: "new"` без OR — отдаём пусто, чтобы Apify не
      // трогали. Шаг 2 узнаётся по OR (brief или insights).
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        return where.OR ? stand.scenarioTrends : []
      },
      updateMany: async () => ({ count: 0 }),
      create: async () => { throw new Error("тренды в тесте не создаются") },
    },
    trendwatcherProfile: { findFirst: async () => null },

    // Дефолтный lookup резолвера воронки: только активные воронки юнита,
    // самая свежая по updatedAt.
    contentFunnel: {
      findFirst: async ({ where }: { where: { appId: number, status: string, id?: string } }) => {
        const row = stand.funnels
          .filter(f => f.appId === where.appId && f.status === where.status)
          .filter(f => (where.id ? f.id === where.id : true))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
        return row ? { id: row.id, keyword: row.keyword, leadMagnet: row.leadMagnet } : null
      },
    },

    scenario: {
      create: async () => ({ id: 900 }),
      findUnique: async () => ({ selectedVariantId: null }),
      update: async () => ({ id: 900 }),
      // Шаг 3: сценариев под видео нет, генерация роликов не запускается.
      findMany: async () => [],
    },
    scenarioVariant: {
      create: async () => ({ id: 1 }),
      findFirst: async () => null,
      update: async () => ({ id: 1 }),
    },

    video: {
      findMany: async ({ include }: { include?: any }) => {
        const variantsInclude = include?.scenario?.include?.variants
        return stand.videos.map(v => ({
          id: v.id,
          variantId: v.variantId,
          scenario: {
            ...v.scenario,
            variants: applyVariantsInclude(v.scenario.variants, variantsInclude),
          },
        }))
      },
      count: async () => 0,
      create: async () => { throw new Error("видео в тесте не создаются") },
    },

    upload: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        stand.uploads.push({ ...data })
        return { id: stand.uploads.length, ...data }
      },
    },
  }
}

function installFakes(stand: Stand): void {
  setGlobal("prisma", createFakePrisma(stand))
  setGlobal("logAgent", async (_agent: string, level: string, message: string) => {
    stand.logs.push({ level, message })
  })
  setGlobal("generateScenarios", async (_trend: unknown, appData: Record<string, unknown>) => {
    stand.appData = appData
    // Пустой результат: дальше шаг только пишет счётчики, платить не за что.
    return []
  })
  setGlobal("runVideoPipeline", async () => { throw new Error("платный вызов в тесте") })
  setGlobal("cancelVideoPipeline", async () => {})
  setGlobal("runUploadPipeline", async () => {})
  setGlobal("runApifyActor", async () => { throw new Error("платный вызов в тесте") })
  setGlobal("waitForApifyRun", async () => {})
  setGlobal("getApifyResults", async () => [])
  setGlobal("abortApifyRun", async () => true)
}

let stand: Stand
let savedPaidApis: string | undefined

beforeEach(() => {
  savedPaidApis = process.env.ENABLE_PAID_APIS
  stand = createStand()
  installFakes(stand)
})

afterEach(() => {
  restoreGlobals()
  if (savedPaidApis === undefined) delete process.env.ENABLE_PAID_APIS
  else process.env.ENABLE_PAID_APIS = savedPaidApis
})

// ══════════════ 1. Воронка доходит до генератора сценария ══════════════

const TREND_FOR_SCENARIOS = {
  id: 11,
  title: "Тренд про завтраки",
  description: "Разбор утренней рутины",
  platform: "instagram",
  hashtags: ["#завтрак"],
  viewCount: 120_000,
  insights: [{ whyViral: "боль зрителя", patterns: ["до/после"], hooks: ["стоп"], audience: "женщины 25-35" }],
  brief: null,
}

const ACTIVE_FUNNEL: FunnelRow = {
  id: "funnel-active",
  appId: APP_ID,
  status: "active",
  keyword: "РАЦИОН",
  updatedAt: new Date("2026-08-01T10:00:00.000Z"),
  leadMagnet: { title: "Гайд: 7 дней без срывов" },
}

const OLD_FUNNEL: FunnelRow = {
  id: "funnel-old",
  appId: APP_ID,
  status: "active",
  keyword: "СТАРТ",
  updatedAt: new Date("2026-06-01T10:00:00.000Z"),
  leadMagnet: { title: "Чек-лист новичка" },
}

describe("цикл из админки: сценарий получает кодовое слово воронки", () => {
  beforeEach(() => {
    process.env.ENABLE_PAID_APIS = "true"
    stand.scenarioTrends = [TREND_FOR_SCENARIOS]
  })

  it("передаёт генератору активную воронку юнита в том же формате, что остальные три входа", async () => {
    stand.funnels = [ACTIVE_FUNNEL]

    await startCycle(CYCLE_ID)

    // Ровно то, что кладут сценарная нода, ручной эндпоинт и путь из идеи:
    // { keyword, leadMagnetTitle } и ничего сверх.
    expect(stand.appData?.funnel).toEqual({
      keyword: "РАЦИОН",
      leadMagnetTitle: "Гайд: 7 дней без срывов",
    })
  })

  it("берёт самую свежую активную воронку, а не первую попавшуюся", async () => {
    stand.funnels = [OLD_FUNNEL, ACTIVE_FUNNEL]

    await startCycle(CYCLE_ID)

    expect(stand.appData?.funnel).toMatchObject({ keyword: "РАЦИОН" })
  })

  it("без активной воронки кладёт funnel=null и предупреждает оператора", async () => {
    stand.funnels = []

    await startCycle(CYCLE_ID)

    // Именно null, а не отсутствующее поле: генератор различает «воронки нет» и
    // «поле забыли передать» — во втором случае он уходил в CTA про приложение.
    expect(stand.appData).not.toBeNull()
    expect(Object.hasOwn(stand.appData!, "funnel")).toBe(true)
    expect(stand.appData?.funnel).toBeNull()
    expect(stand.logs.some(l => l.level === "warn" && l.message.includes("нет активной воронки"))).toBe(true)
  })

  it("не ломает остальной контекст юнита, который ждёт генератор", async () => {
    stand.funnels = [ACTIVE_FUNNEL]

    await startCycle(CYCLE_ID)

    for (const key of ["name", "description", "keywords", "language"]) {
      expect(Object.hasOwn(stand.appData!, key), key).toBe(true)
    }
    expect(stand.appData?.language).toBe("ru")
  })
})

// ══════════════ 2. Вариант в шаге загрузок совпадает с роликом ══════════════

function variant(row: Partial<VariantRow> & { id: number, variantIndex: number }): VariantRow {
  return {
    scenarioId: 900,
    status: "draft",
    isDeleted: false,
    title: `Вариант ${row.variantIndex}`,
    hook: `Хук ${row.variantIndex}`,
    ...row,
  }
}

/** Вариант 0 акцептован исторически, вариант 1 — то, что выбрал оператор. */
const ACCEPTED_FIRST = variant({ id: 10, variantIndex: 0, status: "accepted" })
const OPERATOR_CHOICE = variant({ id: 11, variantIndex: 1, status: "draft" })

function installVideo(selectedVariantId: number | null, videoVariantId: number | null): void {
  stand.videos = [{
    id: 300,
    variantId: videoVariantId,
    scenario: {
      id: 900,
      selectedVariantId,
      variants: [ACCEPTED_FIRST, OPERATOR_CHOICE],
      trend: { hashtags: ["#завтрак"] },
    },
  }]
}

describe("цикл из админки: подпись берётся из варианта, по которому собран ролик", () => {
  beforeEach(() => {
    // Шаг 2 в этих кейсах не нужен — проверяем только шаг 4.
    process.env.ENABLE_PAID_APIS = "false"
  })

  it("уважает жёсткую привязку Video.variantId, а не «первый accepted»", async () => {
    installVideo(OPERATOR_CHOICE.id, OPERATOR_CHOICE.id)

    await startCycle(CYCLE_ID)

    expect(stand.uploads).toHaveLength(1)
    expect(stand.uploads[0]).toMatchObject({
      title: OPERATOR_CHOICE.title,
      description: OPERATOR_CHOICE.hook,
    })
  })

  it("для legacy-ролика без variantId берёт выбор оператора из selectedVariantId", async () => {
    // Ролики этого пути создавались до появления Video.variantId — привязываться
    // не к чему, и решать должно общее правило selectScenarioVariantForVideo.
    installVideo(OPERATOR_CHOICE.id, null)

    await startCycle(CYCLE_ID)

    expect(stand.uploads[0]).toMatchObject({
      title: OPERATOR_CHOICE.title,
      description: OPERATOR_CHOICE.hook,
    })
  })

  it("когда выбора нет вообще, остаётся старое поведение — первый accepted", async () => {
    installVideo(null, null)

    await startCycle(CYCLE_ID)

    expect(stand.uploads[0]).toMatchObject({ title: ACCEPTED_FIRST.title })
  })

  it("хэштеги и ключ идемпотентности не сломаны сменой правила выбора", async () => {
    installVideo(OPERATOR_CHOICE.id, OPERATOR_CHOICE.id)

    await startCycle(CYCLE_ID)

    expect(stand.uploads[0]).toMatchObject({
      hashtags: ["#завтрак"],
      idempotencyKey: `cycle-${CYCLE_ID}-v300-a7`,
      status: "pending",
    })
  })
})
