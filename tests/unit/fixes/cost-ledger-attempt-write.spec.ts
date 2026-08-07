/**
 * Регрессия: ledger занижал траты на повторных прогонах шага.
 *
 * Дефект: дедуп был вечным по (videoId, stepKey, service) — второй реальный
 * прогон (rerunVideoStep, resume после сбоя) провайдеру оплачен, а в ledger не
 * попадал, и burn-rate систематически оказывался меньше настоящего.
 *
 * Здесь проверяем поведение самого logStepCost (что именно оказалось в ledger),
 * а не только сборку условия дедупа. БД нет: prisma подменяется фейком в
 * globalThis (в server/** она приходит из auto-import Nuxt), поэтому модуль
 * импортируется динамически — после установки фейка.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from "vitest"

interface LedgerRow {
  videoId: number | null
  stepKey: string | null
  service: string
  model: string | null
  costUsd: number
  action: string
  status: string
  suggestions?: { attempt?: number }
}

interface LedgerHandle {
  rows: LedgerRow[]
  /** Сколько раз спрашивали «уже есть такая строка?». */
  lookups: number
}

let savedPrisma: unknown
let prismaPatched = false

function installLedgerDb(options: { failOnCreate?: boolean } = {}): LedgerHandle {
  const handle: LedgerHandle = { rows: [], lookups: 0 }
  const holder = globalThis as unknown as Record<string, unknown>
  if (!prismaPatched) {
    savedPrisma = holder.prisma
    prismaPatched = true
  }

  holder.prisma = {
    aiAuditLog: {
      // Повторяем семантику Prisma-фильтра по Json-полю:
      // { suggestions: { path: ["attempt"], equals: N } } матчит только строки,
      // у которых внутри метаданной действительно лежит этот номер попытки.
      findFirst: async (args: { where: Record<string, any> }) => {
        handle.lookups++
        const { where } = args
        const found = handle.rows.find((row) => {
          if (row.videoId !== where.videoId) return false
          if (row.stepKey !== where.stepKey) return false
          if (row.service !== where.service) return false
          if (where.suggestions) {
            const path = where.suggestions.path as string[]
            const value = path.reduce<unknown>(
              (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
              row.suggestions,
            )
            if (value !== where.suggestions.equals) return false
          }
          return true
        })
        return found ? { id: 1 } : null
      },
      create: async (args: { data: LedgerRow }) => {
        if (options.failOnCreate) throw new Error("БД недоступна")
        handle.rows.push({ ...args.data })
        return { id: handle.rows.length }
      },
    },
  }

  return handle
}

afterEach(() => {
  if (prismaPatched) {
    ;(globalThis as unknown as Record<string, unknown>).prisma = savedPrisma
    prismaPatched = false
  }
})

async function logStepCost(...args: Parameters<typeof import("~~/server/utils/balance/cost-ledger")["logStepCost"]>) {
  const mod = await import("~~/server/utils/balance/cost-ledger")
  return mod.logStepCost(...args)
}

const VIDEO = 501
const STEP = "image_generation"
const MODEL = "fal-ai/flux/schnell"

describe("logStepCost: учёт попыток в ledger", () => {
  it("первую попытку пишет без метаданной — строка совместима с историческими", async () => {
    const db = installLedgerDb()

    await logStepCost(1, STEP, null, 0.5, VIDEO, MODEL, { attempt: 1 })

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).toMatchObject({
      videoId: VIDEO,
      stepKey: STEP,
      service: "fal.ai",
      model: MODEL,
      costUsd: 0.5,
      action: "external_api_call",
    })
    expect(db.rows[0]!.suggestions).toBeUndefined()
  })

  it("повторный вызов внутри одной попытки дубля не создаёт", async () => {
    const db = installLedgerDb()

    await logStepCost(1, STEP, null, 0.5, VIDEO, MODEL, { attempt: 1 })
    await logStepCost(1, STEP, null, 0.75, VIDEO, MODEL, { attempt: 1 })

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]!.costUsd).toBe(0.5)
  })

  it("вторая попытка — отдельный факт списания, а не дубль первой", async () => {
    const db = installLedgerDb()

    await logStepCost(1, STEP, null, 0.5, VIDEO, MODEL, { attempt: 1 })
    await logStepCost(1, STEP, null, 0.4, VIDEO, MODEL, { attempt: 2 })

    expect(db.rows).toHaveLength(2)
    expect(db.rows[1]).toMatchObject({ costUsd: 0.4, suggestions: { attempt: 2 } })
    // Ради этого всё и затевалось: сумма по ledger равна реально уплаченному.
    expect(db.rows.reduce((sum, row) => sum + row.costUsd, 0)).toBeCloseTo(0.9, 6)
  })

  it("внутри второй попытки дедуп продолжает работать", async () => {
    const db = installLedgerDb()

    await logStepCost(1, STEP, null, 0.5, VIDEO, MODEL, { attempt: 1 })
    await logStepCost(1, STEP, null, 0.4, VIDEO, MODEL, { attempt: 2 })
    await logStepCost(1, STEP, null, 0.4, VIDEO, MODEL, { attempt: 2 })

    expect(db.rows).toHaveLength(2)
  })

  it("третья попытка не путается со второй", async () => {
    const db = installLedgerDb()

    await logStepCost(1, STEP, null, 0.4, VIDEO, MODEL, { attempt: 2 })
    await logStepCost(1, STEP, null, 0.3, VIDEO, MODEL, { attempt: 3 })

    expect(db.rows.map(r => r.suggestions?.attempt)).toEqual([2, 3])
  })

  it("на исторической строке без метаданной первая попытка по-прежнему skip", async () => {
    // Иначе resume старого видео задублировал бы уже учтённый расход.
    const db = installLedgerDb()
    db.rows.push({
      videoId: VIDEO,
      stepKey: STEP,
      service: "fal.ai",
      model: MODEL,
      costUsd: 0.5,
      action: "external_api_call",
      status: "applied",
    })

    await logStepCost(1, STEP, null, 0.5, VIDEO, MODEL)
    await logStepCost(1, STEP, null, 0.5, VIDEO, MODEL, { attempt: 1 })

    expect(db.rows).toHaveLength(1)
  })

  it("разные видео и разные шаги друг другу не мешают", async () => {
    const db = installLedgerDb()

    await logStepCost(1, STEP, null, 0.5, VIDEO, MODEL)
    await logStepCost(2, STEP, null, 0.5, VIDEO + 1, MODEL)
    await logStepCost(3, "clip_generation", null, 0.7, VIDEO, MODEL)

    expect(db.rows).toHaveLength(3)
  })

  it("нулевую стоимость и шаг без внешнего сервиса в ledger не пишет", async () => {
    const db = installLedgerDb()

    await logStepCost(1, STEP, null, 0, VIDEO, MODEL, { attempt: 2 })
    await logStepCost(2, "assembly", null, 1.5, VIDEO, null, { attempt: 2 })

    expect(db.rows).toHaveLength(0)
    // Даже в БД не ходили — нечего дедуплицировать.
    expect(db.lookups).toBe(0)
  })

  it("падение БД не роняет пайплайн", async () => {
    installLedgerDb({ failOnCreate: true })

    await expect(
      logStepCost(1, STEP, null, 0.5, VIDEO, MODEL, { attempt: 2 }),
    ).resolves.toBeUndefined()
  })
})
