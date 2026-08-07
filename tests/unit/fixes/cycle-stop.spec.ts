/**
 * P1-1 / риск №2 аудита: «деньги на выключенном тормозе».
 *
 * Команда /stop помечала цикл остановленным, но оркестратор:
 *   1. не перечитывал статус между шагами — цикл спокойно шёл дальше и
 *      продолжал тратить деньги на платных вызовах;
 *   2. в конце безусловно писал status=completed поверх stopped — остановка
 *      исчезала даже из истории.
 *
 * Сьюта чистая: ни БД, ни сети. prisma/logAgent и прочие auto-import'ы
 * подменяются в globalThis до вызова оркестратора; телеграм-модули замоканы.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { isCycleStopRequested, requestCycleStop, startCycle } from "~~/server/utils/cycle-orchestrator"
import { cmdStop } from "~~/server/utils/telegram/cmd-cycle"

vi.mock("~~/server/utils/telegram/alerts", () => ({
  sendTelegramAlert: async () => ({ delivered: false }),
}))

vi.mock("~~/server/utils/telegram/messaging", () => ({
  sendMessage: async () => ({ messageId: 1, success: true }),
  editMessage: async () => ({ messageId: 1, success: true }),
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

/**
 * Возвращает globalThis ровно в исходное состояние. Соседние сьюты в этом же
 * воркере проверяют auto-import'ы через `typeof X`, поэтому оставлять после
 * себя ключ со значением undefined нельзя — это уже не «ключа нет».
 */
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

// ───────────────────────── фейковая БД ─────────────────────────

const CYCLE_ID = 77
const STOPPED_AT = new Date("2026-08-07T10:00:00.000Z")

interface CycleRow {
  id: number
  appId: number
  groupId: number | null
  status: string
  completedAt: Date | null
  errorMessage: string | null
  trendsFound: number
  scenariosGen: number
  videosGen: number
  uploadsCount: number
}

interface FakeState {
  cycle: CycleRow
  /** Всё, что записали в ProductionCycle — по ним видно, что финал не затёр stopped. */
  writes: Array<Record<string, unknown>>
  /** Сообщения logAgent — по ним видно, какие шаги реально отработали. */
  logs: string[]
  /** Сколько раз оркестратор перечитал статус цикла. */
  livenessReads: number
  /** Какие модели трогали — «шаг 3 вообще не начинался» проверяется этим. */
  touched: string[]
  /** Хук на очередное чтение статуса: имитирует стоп в конкретный момент. */
  onLiveness?: (readIndex: number, state: FakeState) => void
  /** Хук на logAgent: имитирует /stop посреди цикла. */
  onLog?: (message: string, state: FakeState) => void
}

function createState(): FakeState {
  return {
    cycle: {
      id: CYCLE_ID,
      appId: 5,
      groupId: null,
      status: "pending",
      completedAt: null,
      errorMessage: null,
      trendsFound: 0,
      scenariosGen: 0,
      videosGen: 0,
      uploadsCount: 0,
    },
    writes: [],
    logs: [],
    livenessReads: 0,
    touched: [],
  }
}

/** Имитация внешней остановки: строка в БД уже stopped. */
function markStoppedInDb(state: FakeState): void {
  state.cycle.status = "stopped"
  state.cycle.completedAt = STOPPED_AT
}

function createFakePrisma(state: FakeState): Record<string, unknown> {
  const cycleModel = {
    findUnique: async ({ where, select }: { where: { id: number }, select?: Record<string, boolean> }) => {
      if (where.id !== state.cycle.id) return null

      if (select?.status) {
        state.livenessReads += 1
        const snapshot = { status: state.cycle.status }
        state.onLiveness?.(state.livenessReads, state)
        return snapshot
      }
      if (select?.completedAt) return { completedAt: state.cycle.completedAt }

      return {
        ...state.cycle,
        app: { id: 5, name: "Реформа", description: null, keywords: [], language: "ru" },
        accountGroup: null,
      }
    },
    findFirst: async ({ where }: { where?: { status?: { in?: string[] } | string } }) => {
      const wanted = where?.status
      const statuses = typeof wanted === "string" ? [wanted] : wanted?.in ?? []
      return statuses.includes(state.cycle.status) ? { ...state.cycle } : null
    },
    update: async ({ where, data }: { where: { id: number }, data: Record<string, unknown> }) => {
      if (where.id !== state.cycle.id) throw new Error("нет такой строки")
      state.writes.push({ ...data })
      Object.assign(state.cycle, data)
      return { ...state.cycle }
    },
    updateMany: async (
      { where, data }: { where: { id: number, status?: { in: string[] } }, data: Record<string, unknown> },
    ) => {
      if (where.id !== state.cycle.id) return { count: 0 }
      // Условная запись — именно она не даёт затереть stopped на completed.
      if (where.status?.in && !where.status.in.includes(state.cycle.status)) return { count: 0 }
      state.writes.push({ ...data })
      Object.assign(state.cycle, data)
      return { count: 1 }
    },
  }

  const touch = (model: string) => { state.touched.push(model) }

  return {
    productionCycle: cycleModel,
    trend: {
      findMany: async () => { touch("trend.findMany"); return [] },
      updateMany: async () => ({ count: 0 }),
    },
    trendwatcherProfile: { findFirst: async () => null },
    trendwatcherRun: {
      create: async () => ({ id: 1 }),
      update: async () => ({ id: 1 }),
    },
    scenario: {
      findMany: async () => { touch("scenario.findMany"); return [] },
      create: async () => { throw new Error("не должно вызываться") },
    },
    video: {
      findMany: async () => { touch("video.findMany"); return [] },
      count: async () => { touch("video.count"); return 0 },
      create: async () => { throw new Error("не должно вызываться") },
    },
    upload: {
      findUnique: async () => null,
      create: async () => { throw new Error("не должно вызываться") },
    },
    telegramChat: { findUnique: async () => ({ chatId: "1", userId: 9 }) },
    zavodUser: { findUnique: async () => ({ id: 9, canRunAgent: true }) },
  }
}

function installFakes(state: FakeState): void {
  setGlobal("prisma", createFakePrisma(state))
  setGlobal("logAgent", async (_agent: string, _level: string, message: string) => {
    state.logs.push(message)
    state.onLog?.(message, state)
  })
  setGlobal("generateScenarios", async () => { throw new Error("платный вызов в тесте") })
  setGlobal("runVideoPipeline", async () => { throw new Error("платный вызов в тесте") })
  setGlobal("cancelVideoPipeline", async () => {})
  setGlobal("runUploadPipeline", async () => {})
  setGlobal("runApifyActor", async () => { throw new Error("платный вызов в тесте") })
  setGlobal("waitForApifyRun", async () => {})
  setGlobal("getApifyResults", async () => [])
  setGlobal("abortApifyRun", async () => true)
}

/** Шаги, которые оркестратор отметил в логе. */
function stepsFromLogs(logs: string[]): string[] {
  return logs.filter((m) => m.startsWith("Шаг ")).map((m) => m.slice(0, 5).trim())
}

let state: FakeState
let savedPaidApis: string | undefined

beforeEach(() => {
  // Платные API в тесте выключены: шаг 2 не должен никуда ходить.
  savedPaidApis = process.env.ENABLE_PAID_APIS
  process.env.ENABLE_PAID_APIS = "false"
  state = createState()
  installFakes(state)
})

afterEach(() => {
  restoreGlobals()
  if (savedPaidApis === undefined) delete process.env.ENABLE_PAID_APIS
  else process.env.ENABLE_PAID_APIS = savedPaidApis
})

// ══════════════ 1. Остановка реально прекращает выполнение ══════════════

describe("остановка цикла между шагами", () => {
  it("сигнал /stop после первого шага не пускает цикл дальше", async () => {
    state.onLog = (message) => {
      if (!message.startsWith("Шаг 1")) return
      // Ровно то, что делает cmdStop: статус в БД + сигнал в память.
      markStoppedInDb(state)
      requestCycleStop(CYCLE_ID)
    }

    await startCycle(CYCLE_ID)

    expect(stepsFromLogs(state.logs)).toEqual(["Шаг 1"])
    expect(state.touched).not.toContain("scenario.findMany")
    expect(state.touched).not.toContain("video.findMany")
    expect(state.cycle.status).toBe("stopped")
  })

  it("остановка из другого процесса (только запись в БД) тоже тормозит цикл", async () => {
    // Сигнала нет — стоп пришёл в другом инстансе, у нас только строка в БД.
    state.onLog = (message) => {
      if (message.startsWith("Шаг 1")) markStoppedInDb(state)
    }

    await startCycle(CYCLE_ID)

    expect(stepsFromLogs(state.logs)).toEqual(["Шаг 1"])
    expect(state.cycle.status).toBe("stopped")
  })

  it("цикл, остановленный до старта, не запускается вовсе", async () => {
    markStoppedInDb(state)

    await startCycle(CYCLE_ID)

    expect(stepsFromLogs(state.logs)).toEqual([])
    expect(state.cycle.status).toBe("stopped")
    expect(state.writes.some((w) => w.status === "running")).toBe(false)
  })
})

// ══════════════ 2. Финал не затирает stopped ══════════════

describe("финализация остановленного цикла", () => {
  it("статус остаётся stopped, completed не пишется ни разу", async () => {
    state.onLog = (message) => {
      if (message.startsWith("Шаг 4")) {
        markStoppedInDb(state)
        requestCycleStop(CYCLE_ID)
      }
    }

    await startCycle(CYCLE_ID)

    expect(state.cycle.status).toBe("stopped")
    expect(state.writes.some((w) => w.status === "completed")).toBe(false)
    expect(state.writes.some((w) => w.status === "failed")).toBe(false)
  })

  it("стоп в зазоре между последней проверкой и записью финала не превращается в completed", async () => {
    // Пятое чтение статуса — барьер перед финальной записью. Отдаём «running»
    // и тут же помечаем цикл остановленным: гонка, из-за которой финал и
    // затирал stopped.
    state.onLiveness = (readIndex, current) => {
      if (readIndex === 5) markStoppedInDb(current)
    }

    await startCycle(CYCLE_ID)

    expect(state.cycle.status).toBe("stopped")
    expect(state.writes.some((w) => w.status === "completed")).toBe(false)
  })

  it("момент остановки не сдвигается, счётчики сделанного сохраняются", async () => {
    state.onLog = (message) => {
      if (message.startsWith("Шаг 1")) {
        markStoppedInDb(state)
        requestCycleStop(CYCLE_ID)
      }
    }

    await startCycle(CYCLE_ID)

    expect(state.cycle.completedAt).toEqual(STOPPED_AT)
    expect(state.cycle.trendsFound).toBe(0)
    expect(state.cycle.scenariosGen).toBe(0)
  })
})

// ══════════════ 3. Идемпотентность повторного стопа ══════════════

describe("повторный /stop", () => {
  it("requestCycleStop дважды не ломает уже остановленный цикл", async () => {
    state.onLog = (message) => {
      if (message.startsWith("Шаг 1")) {
        markStoppedInDb(state)
        requestCycleStop(CYCLE_ID)
        requestCycleStop(CYCLE_ID)
      }
    }

    await startCycle(CYCLE_ID)

    // Цикла в реестре уже нет — стоп ничего не находит, но и не падает.
    expect(requestCycleStop(CYCLE_ID)).toBe(false)
    expect(isCycleStopRequested(CYCLE_ID)).toBe(false)
    expect(state.cycle.status).toBe("stopped")
    expect(state.cycle.completedAt).toEqual(STOPPED_AT)
  })

  it("cmdStop повторно отвечает «нет активных» и не двигает completedAt", async () => {
    state.cycle.status = "running"

    await cmdStop("token", "1")
    const firstStopAt = state.cycle.completedAt
    expect(state.cycle.status).toBe("stopped")
    expect(firstStopAt).toBeInstanceOf(Date)

    const writesAfterFirst = state.writes.length
    await cmdStop("token", "1")

    expect(state.cycle.status).toBe("stopped")
    expect(state.cycle.completedAt).toEqual(firstStopAt)
    expect(state.writes.length).toBe(writesAfterFirst)
  })
})

// ══════════════ 4. Обычный цикл не сломан ══════════════

describe("цикл без остановки", () => {
  it("доходит до конца и закрывается как completed", async () => {
    await startCycle(CYCLE_ID)

    expect(stepsFromLogs(state.logs)).toEqual(["Шаг 1", "Шаг 2", "Шаг 3", "Шаг 4"])
    expect(state.cycle.status).toBe("completed")
    expect(state.cycle.completedAt).toBeInstanceOf(Date)
  })
})
