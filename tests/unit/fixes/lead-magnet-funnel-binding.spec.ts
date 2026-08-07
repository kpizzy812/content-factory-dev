/**
 * Регрессии трёх дефектов лид-магнита (docs/audit/spec-conformance-2026-08-07.md):
 *
 *   P0-3. Автосозданный LeadMagnet привязывался только к гипотезе, а выдача в
 *         мессенджере (factory-automation/chatplace-mcp.ts) и атрибуция читают
 *         funnel.leadMagnet. Материал был, отдать его было некому — главный
 *         сценарий ТЗ «кодовое слово в директ → выдача лид-магнита» не работал.
 *   P0-4. Не было перехода статуса: магнит рождался draft, а флагманский пресет
 *         требует approved. Партия падала на quality gate всегда.
 *   P1-28. На каждый прогон партии создавался новый магнит вместо переиспользования
 *         подходящего из библиотеки приложения (до 300 черновиков в сутки).
 *
 * Сьюта чистая: БД и сети нет. Модуль стратегии ходит в prisma через
 * auto-import Nuxt, поэтому фейк кладём в globalThis ДО динамического импорта.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach, vi } from "vitest"

// ───────────────────────── общие хелперы ─────────────────────────

const savedGlobals = new Map<string, unknown>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!savedGlobals.has(name)) savedGlobals.set(name, holder[name])
  holder[name] = value
}

afterEach(() => {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const [name, value] of savedGlobals) holder[name] = value
  savedGlobals.clear()
})

/** Ошибка h3: createError кидает объект со statusCode. */
class FakeHttpError extends Error {
  statusCode: number

  constructor(params: { statusCode?: number, message?: string }) {
    super(params.message ?? "ошибка")
    this.statusCode = params.statusCode ?? 500
  }
}

// ══════════ 1. Стратегия: привязка к воронке и переиспользование ══════════

/** Что вернул бы агент стратегии. Тема — вечерние срывы на сладкое. */
const GENERATED = {
  title: "Почему вечером тянет на сладкое",
  angle: "разбор",
  audience: "женщины 25-35",
  problem: "вечерние срывы на сладкое",
  promise: "неделя без срывов",
  hook: "стоп, это не сила воли",
  cta: "Напишите «РАЦИОН» в комментариях.",
  keyword: "РАЦИОН",
  proofPoints: ["исследование"],
  rationale: "внутренние метрики",
  leadMagnet: {
    title: "Гайд: 7 дней без срывов",
    format: "pdf",
    problem: "вечерние срывы на сладкое",
    audience: "женщины 25-35",
    sections: [{ title: "День 1", content: "текст" }],
    deliveryMessage: "Держите гайд",
    warmupMessages: [{ delayHours: 24, text: "Как первый день?" }],
  },
}

vi.mock("~~/server/utils/agents/content-strategy-agent", () => ({
  generateContentStrategy: async () => JSON.parse(JSON.stringify(GENERATED)),
  contentHypothesisFingerprint: () => "fingerprint-1",
}))

interface LeadMagnetRow {
  id: string
  appId: number
  status: string
  title: string
  problem: string | null
  audience: string | null
  updatedAt: Date
}

interface FunnelRow {
  id: string
  appId: number
  status: string
  keyword: string
  leadMagnetId: string | null
}

interface StrategyRun {
  /** Данные создания новых магнитов: пусто = переиспользовали существующий. */
  createdMagnets: Array<Record<string, unknown>>
  /** Аргументы contentFunnel.updateMany: так видно привязку магнита к воронке. */
  funnelUpdates: Array<{ where: Record<string, unknown>, data: Record<string, unknown> }>
  hypothesis: Record<string, unknown>
  result: Record<string, unknown>
  funnels: FunnelRow[]
  library: LeadMagnetRow[]
}

const APP_ID = 42

function magnet(row: Partial<LeadMagnetRow> & { id: string, status: string }): LeadMagnetRow {
  return {
    appId: APP_ID,
    title: "Гайд: 7 дней без срывов",
    problem: "вечерние срывы на сладкое",
    audience: "женщины 25-35",
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...row,
  }
}

/**
 * Прогоняет ноду стратегии на фейковой БД и возвращает всё, что она записала.
 */
async function runStrategyNode(options: {
  funnel?: FunnelRow | null
  library?: LeadMagnetRow[]
  config?: Record<string, unknown>
}): Promise<StrategyRun> {
  const funnels = options.funnel ? [options.funnel] : []
  const library = options.library ? [...options.library] : []
  const run = {
    createdMagnets: [] as Array<Record<string, unknown>>,
    funnelUpdates: [] as Array<{ where: Record<string, unknown>, data: Record<string, unknown> }>,
    funnels,
    library,
  } as StrategyRun

  const db = {
    app: { findUnique: async () => ({ id: APP_ID, name: "Реформа", language: "ru" }) },
    contentFunnel: {
      findFirst: async (args: { where: { id: string, appId: number } }) => {
        const row = funnels.find(f => f.id === args.where.id && f.appId === args.where.appId)
        if (!row) return null
        return {
          ...row,
          leadMagnet: row.leadMagnetId
            ? library.find(m => m.id === row.leadMagnetId) ?? null
            : null,
        }
      },
      updateMany: async (args: { where: Record<string, unknown>, data: Record<string, unknown> }) => {
        run.funnelUpdates.push(args)
        const row = funnels.find(f => f.id === args.where.id)
        // Повторяем семантику updateMany с leadMagnetId: null в WHERE —
        // запись обновится, только если магнит ещё не привязан.
        if (!row || (args.where.leadMagnetId === null && row.leadMagnetId !== null)) return { count: 0 }
        Object.assign(row, args.data)
        return { count: 1 }
      },
    },
    leadMagnet: {
      findMany: async (args: { where: { appId: number, status: { in: string[] } } }) => library
        .filter(m => m.appId === args.where.appId && args.where.status.in.includes(m.status))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map(m => ({ ...m })),
      create: async (args: { data: Record<string, unknown> }) => {
        run.createdMagnets.push(args.data)
        const created = magnet({
          id: `magnet-new-${run.createdMagnets.length}`,
          status: String(args.data.status),
          title: String(args.data.title),
          problem: args.data.problem as string,
          audience: args.data.audience as string,
        })
        library.push(created)
        return created
      },
    },
    contentHypothesis: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        run.hypothesis = args.data
        const funnelRow = args.data.funnelId
          ? funnels.find(f => f.id === args.data.funnelId) ?? null
          : null
        return {
          ...args.data,
          funnel: funnelRow
            ? {
                ...funnelRow,
                leadMagnet: funnelRow.leadMagnetId
                  ? library.find(m => m.id === funnelRow.leadMagnetId) ?? null
                  : null,
              }
            : null,
          leadMagnet: library.find(m => m.id === args.data.leadMagnetId) ?? null,
        }
      },
    },
    factoryPublication: { updateMany: async () => ({ count: 0 }) },
    productionCycle: { findUnique: async () => null },
    workflowRun: { findUnique: async () => null },
    trend: { findMany: async () => [] },
    idea: { findMany: async () => [] },
    postMetrics: { findMany: async () => [] },
  }

  setGlobal("prisma", { ...db, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) })

  const { executeContentStrategyNode } = await import("~~/server/utils/pipeline-content-strategy")
  run.result = await executeContentStrategyNode(
    {
      appId: APP_ID,
      useTrendBank: false,
      useInternalMetrics: false,
      ...(options.funnel ? { funnelId: options.funnel.id } : {}),
      ...options.config,
    },
    {},
  ) as Record<string, unknown>

  return run
}

const FUNNEL_WITHOUT_MAGNET: FunnelRow = {
  id: "funnel-1",
  appId: APP_ID,
  status: "active",
  keyword: "РАЦИОН",
  leadMagnetId: null,
}

describe("нода стратегии: лид-магнит и воронка", () => {
  it("привязывает автосозданный магнит к воронке, а не только к гипотезе", async () => {
    const run = await runStrategyNode({ funnel: { ...FUNNEL_WITHOUT_MAGNET } })

    const magnetId = run.createdMagnets.length ? run.funnels[0]!.leadMagnetId : null
    // Суть дефекта: раньше это поле оставалось null и выдача материала
    // (funnel.leadMagnet) была пустой при живом магните у гипотезы.
    expect(run.funnels[0]!.leadMagnetId).not.toBeNull()
    expect(run.funnelUpdates).toHaveLength(1)
    expect(run.funnelUpdates[0]!.where).toMatchObject({ id: "funnel-1", leadMagnetId: null })
    expect(run.funnelUpdates[0]!.data).toEqual({ leadMagnetId: magnetId })
    // Гипотеза по-прежнему помнит свой магнит — это второй источник выдачи.
    expect(run.hypothesis.leadMagnetId).toBe(magnetId)
    // И нода отдаёт дальше именно магнит воронки.
    expect((run.result.leadMagnet as { id: string }).id).toBe(magnetId)
  })

  it("не перетирает уже привязанный магнит воронки", async () => {
    const existing = magnet({ id: "magnet-approved", status: "approved" })
    const run = await runStrategyNode({
      funnel: { ...FUNNEL_WITHOUT_MAGNET, leadMagnetId: existing.id },
      library: [existing],
    })

    expect(run.createdMagnets).toHaveLength(0)
    expect(run.funnelUpdates).toHaveLength(0)
    expect(run.funnels[0]!.leadMagnetId).toBe("magnet-approved")
    expect(run.hypothesis.leadMagnetId).toBe("magnet-approved")
  })

  it("переиспользует подходящий утверждённый магнит из библиотеки", async () => {
    const approved = magnet({
      id: "magnet-approved",
      status: "approved",
      title: "Чек-лист: 7 дней без срывов на сладкое",
      problem: "вечерние срывы на сладкое",
    })
    const run = await runStrategyNode({ funnel: { ...FUNNEL_WITHOUT_MAGNET }, library: [approved] })

    // Раньше здесь создавался новый черновик на КАЖДЫЙ прогон партии.
    expect(run.createdMagnets).toHaveLength(0)
    expect(run.hypothesis.leadMagnetId).toBe("magnet-approved")
    expect(run.funnels[0]!.leadMagnetId).toBe("magnet-approved")
  })

  it("утверждённый материал важнее свежего черновика на ту же тему", async () => {
    const run = await runStrategyNode({
      funnel: { ...FUNNEL_WITHOUT_MAGNET },
      library: [
        magnet({ id: "magnet-draft", status: "draft", updatedAt: new Date("2026-08-06T00:00:00.000Z") }),
        magnet({ id: "magnet-approved", status: "approved", updatedAt: new Date("2026-07-01T00:00:00.000Z") }),
      ],
    })

    expect(run.createdMagnets).toHaveLength(0)
    expect(run.hypothesis.leadMagnetId).toBe("magnet-approved")
  })

  it("создаёт новый магнит, если в библиотеке только чужая тема", async () => {
    const run = await runStrategyNode({
      funnel: { ...FUNNEL_WITHOUT_MAGNET },
      library: [
        magnet({
          id: "magnet-alien",
          status: "approved",
          title: "Гайд по холодному душу",
          problem: "нет энергии утром",
          audience: "мужчины 30+",
        }),
        magnet({ id: "magnet-archived", status: "archived" }),
      ],
    })

    // Отдать зрителю материал не по теме ролика хуже, чем сгенерировать новый.
    expect(run.createdMagnets).toHaveLength(1)
    expect(run.createdMagnets[0]!.status).toBe("draft")
    expect(run.hypothesis.leadMagnetId).toBe("magnet-new-1")
  })

  it("архивный материал не переиспользуется даже на своей теме", async () => {
    const run = await runStrategyNode({
      funnel: { ...FUNNEL_WITHOUT_MAGNET },
      library: [magnet({ id: "magnet-archived", status: "archived" })],
    })

    expect(run.createdMagnets).toHaveLength(1)
    expect(run.hypothesis.leadMagnetId).toBe("magnet-new-1")
  })

  it("reuseLeadMagnets=false выключает подбор из библиотеки", async () => {
    const run = await runStrategyNode({
      funnel: { ...FUNNEL_WITHOUT_MAGNET },
      library: [magnet({ id: "magnet-approved", status: "approved" })],
      config: { reuseLeadMagnets: false },
    })

    expect(run.createdMagnets).toHaveLength(1)
  })
})

// ══════════════════ 2. Таблица переходов статуса ══════════════════

describe("переходы статуса лид-магнита", () => {
  it("разрешает утверждение, отзыв и архивацию", async () => {
    const { canTransitionLeadMagnetStatus } = await import("~~/server/utils/lead-magnet-library")

    expect(canTransitionLeadMagnetStatus("draft", "approved")).toBe(true)
    expect(canTransitionLeadMagnetStatus("draft", "archived")).toBe(true)
    expect(canTransitionLeadMagnetStatus("approved", "draft")).toBe(true)
    expect(canTransitionLeadMagnetStatus("approved", "archived")).toBe(true)
    expect(canTransitionLeadMagnetStatus("archived", "draft")).toBe(true)
  })

  it("запрещает утверждение архивного и любые неизвестные статусы", async () => {
    const { canTransitionLeadMagnetStatus } = await import("~~/server/utils/lead-magnet-library")

    // Архивный сначала возвращают в черновик и перечитывают.
    expect(canTransitionLeadMagnetStatus("archived", "approved")).toBe(false)
    expect(canTransitionLeadMagnetStatus("draft", "published")).toBe(false)
    expect(canTransitionLeadMagnetStatus("published", "approved")).toBe(false)
    expect(canTransitionLeadMagnetStatus("draft", "")).toBe(false)
    expect(canTransitionLeadMagnetStatus("draft", null)).toBe(false)
    // Переход «в себя» таблицей не описан: решение принимает вызывающий код.
    expect(canTransitionLeadMagnetStatus("draft", "draft")).toBe(false)
  })
})

// ══════════════════ 3. PATCH /api/factory/lead-magnets/:id ══════════════════

interface PatchRun {
  status: number | null
  body: Record<string, unknown> | null
  updates: Array<Record<string, unknown>>
  scopes: Array<Record<string, unknown>>
}

/**
 * Дёргает обработчик PATCH напрямую с h3-глобалами и фейковой БД.
 */
async function patchLeadMagnet(
  current: { id: string, appId: number, status: string } | null,
  body: Record<string, unknown>,
): Promise<PatchRun> {
  const run: PatchRun = { status: null, body: null, updates: [], scopes: [] }

  setGlobal("defineEventHandler", (fn: unknown) => fn)
  setGlobal("getRouterParam", () => current?.id ?? "magnet-1")
  setGlobal("readBody", async () => body)
  setGlobal("createError", (params: ConstructorParameters<typeof FakeHttpError>[0]) => new FakeHttpError(params))
  setGlobal("requireScopedAccess", async (_event: unknown, options: Record<string, unknown>) => {
    run.scopes.push(options)
    return { id: 1 }
  })
  setGlobal("logAgent", async () => {})
  setGlobal("prisma", {
    leadMagnet: {
      findUnique: async () => (current ? { ...current } : null),
      update: async (args: { data: Record<string, unknown> }) => {
        run.updates.push(args.data)
        return { ...current, ...args.data }
      },
    },
  })

  const handler = (await import("~~/server/api/factory/lead-magnets/[id].patch")).default as
    (event: unknown) => Promise<Record<string, unknown>>
  try {
    run.body = await handler({})
  } catch (error) {
    if (!(error instanceof FakeHttpError)) throw error
    run.status = error.statusCode
  }
  return run
}

const DRAFT = { id: "magnet-1", appId: APP_ID, status: "draft" }

describe("PATCH /api/factory/lead-magnets/:id", () => {
  it("утверждает черновик и требует права на запись в приложении", async () => {
    const run = await patchLeadMagnet(DRAFT, { status: "approved" })

    expect(run.status).toBeNull()
    expect(run.updates).toEqual([{ status: "approved" }])
    expect(run.scopes[0]).toMatchObject({ permissions: ["canWrite"], appId: APP_ID })
  })

  it("не утверждает архивный материал", async () => {
    const run = await patchLeadMagnet({ ...DRAFT, status: "archived" }, { status: "approved" })

    expect(run.status).toBe(409)
    expect(run.updates).toEqual([])
  })

  it("не принимает выдуманный статус", async () => {
    const run = await patchLeadMagnet(DRAFT, { status: "published" })

    expect(run.status).toBe(400)
    expect(run.updates).toEqual([])
  })

  it("повторное утверждение — идемпотентный no-op, а не ошибка", async () => {
    const run = await patchLeadMagnet({ ...DRAFT, status: "approved" }, { status: "approved" })

    expect(run.status).toBeNull()
    expect(run.updates).toEqual([])
    expect(run.body?.changed).toBe(false)
  })

  it("не даёт править текст утверждённого материала", async () => {
    // Иначе гейт качества пропускает партию по одному тексту, а зритель
    // получает другой.
    const run = await patchLeadMagnet({ ...DRAFT, status: "approved" }, { title: "Подменённый гайд" })

    expect(run.status).toBe(409)
    expect(run.updates).toEqual([])
  })

  it("правит черновик и утверждает его одним запросом", async () => {
    const run = await patchLeadMagnet(DRAFT, { title: "Гайд: 7 дней без срывов", status: "approved" })

    expect(run.status).toBeNull()
    expect(run.updates[0]).toEqual({ title: "Гайд: 7 дней без срывов", status: "approved" })
  })

  it("отвечает 404 на несуществующий магнит и не спрашивает права", async () => {
    const run = await patchLeadMagnet(null, { status: "approved" })

    expect(run.status).toBe(404)
    expect(run.scopes).toEqual([])
  })
})

// ═════════ 4. Выдача магнита в атрибуции: воронка и запасной источник ═════════

/**
 * Публикации, созданные ДО привязки магнита к воронке, живут с пустым
 * funnel.leadMagnetId. Для них выдача обязана падать на магнит гипотезы,
 * иначе зритель, написавший кодовое слово, не получит ничего.
 */
async function resolveAttributionLeadMagnet(publication: {
  funnelMagnet: { id: string, title: string } | null
  hypothesisMagnet: { id: string, title: string } | null
}): Promise<{ leadMagnet: { id: string, title: string } | null, leadMagnetId: string | null }> {
  const secret = "s3cret-token"
  const { hashContentFactoryWebhookSecret } = await import("~~/server/utils/content-factory-attribution")

  const magnetRow = (row: { id: string, title: string } | null) =>
    row ? { ...row, content: { body: "текст" }, deliveryMessage: "держите", warmupMessages: null } : null

  setGlobal("defineEventHandler", (fn: unknown) => fn)
  setGlobal("getRouterParam", () => "cf_abcdefghijklmnopqrst")
  // Именно то событие, ради которого нужен магнит: бот дошёл до выдачи материала.
  setGlobal("readRawBody", async () => JSON.stringify({ eventType: "lead_magnet_delivered" }))
  setGlobal("createError", (params: ConstructorParameters<typeof FakeHttpError>[0]) => new FakeHttpError(params))
  setGlobal("getRequestHeader", (_event: unknown, name: string) =>
    name === "x-content-factory-secret" ? secret : undefined)
  setGlobal("setResponseHeader", () => {})
  setGlobal("prisma", {
    factoryPublication: {
      findMany: async () => [{
        id: "pub-1",
        platform: "instagram",
        socialAccountId: 7,
        platformPostId: "media-1",
        platformPostUrl: "https://instagram.com/reel/1",
        keyword: "РАЦИОН",
        funnel: {
          id: "funnel-1",
          keyword: "РАЦИОН",
          deliveryAdapter: "telegram",
          deliveryConfig: { botUsername: "reforma_bot" },
          conversionAdapter: "webform",
          conversionUrl: "https://reforma.app/lead",
          conversionTrackingParam: "tracking_token",
          webhookSecretHash: hashContentFactoryWebhookSecret(secret),
          leadMagnetId: publication.funnelMagnet?.id ?? null,
          leadMagnet: magnetRow(publication.funnelMagnet),
        },
        hypothesis: {
          id: "hyp-1",
          leadMagnetId: publication.hypothesisMagnet?.id ?? null,
          leadMagnet: magnetRow(publication.hypothesisMagnet),
        },
        socialAccount: { id: 7, displayName: "Reforma", platformHandle: "reforma", platformUserId: "77" },
        upload: null,
        run: { scenarios: [{ id: "scenario-1" }] },
      }],
    },
    attributionEvent: {
      findUnique: async () => null,
      upsert: async () => ({ id: "event-1", occurredAt: new Date("2026-08-07T10:00:00.000Z") }),
    },
  })

  const handler = (await import("~~/server/api/factory/attribution/[trackingToken].post")).default as
    (event: unknown) => Promise<{ data: Record<string, unknown> }>
  const response = await handler({})
  return {
    leadMagnet: response.data.leadMagnet as { id: string, title: string } | null,
    leadMagnetId: (response.data.attribution as { leadMagnetId: string | null }).leadMagnetId,
  }
}

describe("атрибуция: источник лид-магнита для выдачи", () => {
  it("отдаёт магнит воронки, когда он привязан", async () => {
    const result = await resolveAttributionLeadMagnet({
      funnelMagnet: { id: "magnet-funnel", title: "Гайд воронки" },
      hypothesisMagnet: { id: "magnet-hypothesis", title: "Гайд гипотезы" },
    })

    expect(result.leadMagnet?.id).toBe("magnet-funnel")
    expect(result.leadMagnetId).toBe("magnet-funnel")
  })

  it("падает на магнит гипотезы у публикаций без привязки к воронке", async () => {
    const result = await resolveAttributionLeadMagnet({
      funnelMagnet: null,
      hypothesisMagnet: { id: "magnet-hypothesis", title: "Гайд гипотезы" },
    })

    // Суть дефекта: раньше здесь возвращался null при живом магните у гипотезы —
    // зритель, написавший кодовое слово, не получал материал.
    expect(result.leadMagnet?.id).toBe("magnet-hypothesis")
    expect(result.leadMagnetId).toBe("magnet-hypothesis")
  })

  it("честно отдаёт null, когда магнита нет нигде", async () => {
    const result = await resolveAttributionLeadMagnet({ funnelMagnet: null, hypothesisMagnet: null })

    expect(result.leadMagnet).toBeNull()
    expect(result.leadMagnetId).toBeNull()
  })
})
