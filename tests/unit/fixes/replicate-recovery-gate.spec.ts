import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Регрессия на гейт планировщика восстановления Replicate.
 *
 * Раньше плагин стартовал только при `SCHEDULERS_ENABLED === "true"`. Переменная
 * относится к тестовой инфраструктуре, в проде её никто не выставляет — и
 * восстановление потерянных predictions молча не поднималось: вебхук потерян,
 * ссылка Replicate протухла, деньги списаны, ролика нет. Семантика должна быть
 * «выключено только при явном false».
 *
 * Сервис prediction'ов подменён: настоящий тянет prisma, а сьюта DB-free.
 */

const mocks = vi.hoisted(() => {
  const recoverStalePredictions = vi.fn(async () => ({ inspected: 0, recovered: 0, failed: 0 }))
  return {
    recoverStalePredictions,
    createPredictionService: vi.fn(() => ({ recoverStalePredictions })),
  }
})

vi.mock("../../../server/utils/replicate/prediction-service", () => ({
  createPredictionService: mocks.createPredictionService,
}))

interface TrackedIntervalCall {
  key: string
  label: string
  intervalMs: number
}

const trackedCalls: TrackedIntervalCall[] = []
const trackedInterval = vi.fn((key: string, label: string, intervalMs: number) => {
  trackedCalls.push({ key, label, intervalMs })
  return { unref: vi.fn() }
})

const ENV_KEYS = [
  "SCHEDULERS_ENABLED",
  "REPLICATE_MOCK_MODE",
  "REPLICATE_RECOVERY_ENABLED",
  "REPLICATE_API_TOKEN",
  "REPLICATE_WEBHOOK_BASE_URL",
  "REPLICATE_WEBHOOK_SIGNING_SECRET",
] as const

let startRecovery: (nitro: { hooks: { hook: (name: string, fn: () => void) => void } }) => void
let savedEnv: Array<readonly [string, string | undefined]> = []
let savedGlobals: Array<readonly [string, unknown]> = []

beforeAll(async () => {
  // Плагин пользуется auto-import'ами Nuxt: в чистом vitest их подменяем сами.
  // Прежние значения запоминаем — сьюта однопоточная, мусор в globalThis
  // достался бы соседним файлам.
  const globals = globalThis as unknown as Record<string, unknown>
  savedGlobals = [
    ["defineNitroPlugin", globals.defineNitroPlugin],
    ["trackedInterval", globals.trackedInterval],
  ]
  globals.defineNitroPlugin = (handler: unknown) => handler
  globals.trackedInterval = trackedInterval

  const module = await import("../../../server/plugins/replicate-recovery")
  startRecovery = module.default as never
})

afterAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  for (const [key, value] of savedGlobals) {
    if (value === undefined) delete globals[key]
    else globals[key] = value
  }
})

beforeEach(() => {
  savedEnv = ENV_KEYS.map(key => [key, process.env[key]] as const)
  for (const key of ENV_KEYS) delete process.env[key]
  // Mock-режим: живой клиент Replicate из теста не поднимаем.
  process.env.REPLICATE_MOCK_MODE = "true"
  trackedCalls.length = 0
  trackedInterval.mockClear()
  mocks.createPredictionService.mockClear()
  mocks.recoverStalePredictions.mockClear()
})

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function start() {
  const hook = vi.fn()
  startRecovery({ hooks: { hook } })
  return { hook }
}

describe("Replicate recovery: гейт планировщика", () => {
  it("поднимается, когда SCHEDULERS_ENABLED не задан", () => {
    expect(process.env.SCHEDULERS_ENABLED).toBeUndefined()

    start()

    // Суть дефекта: со старым `!== "true"` тут был ноль вызовов.
    expect(trackedCalls).toEqual([
      { key: "replicate-recovery", label: expect.any(String), intervalMs: 60_000 },
    ])
    expect(mocks.createPredictionService).toHaveBeenCalledTimes(1)
  })

  it("виден в реестре планировщиков под своим ключом", () => {
    start()

    // Восстановление ходит через trackedInterval, а не голый setInterval —
    // иначе задачи нет в /admin и никто не заметит, что она умерла.
    expect(trackedInterval).toHaveBeenCalledTimes(1)
    expect(trackedCalls[0]!.key).toBe("replicate-recovery")
    expect(trackedCalls[0]!.label.trim()).not.toBe("")
  })

  it("молчит только при явном SCHEDULERS_ENABLED=false", () => {
    process.env.SCHEDULERS_ENABLED = "false"

    start()

    expect(trackedInterval).not.toHaveBeenCalled()
    expect(mocks.createPredictionService).not.toHaveBeenCalled()
  })

  it("не сломан для старого явного включения", () => {
    process.env.SCHEDULERS_ENABLED = "true"

    start()

    expect(trackedInterval).toHaveBeenCalledTimes(1)
  })

  it("оставляет собственный выключатель восстановления", () => {
    process.env.REPLICATE_RECOVERY_ENABLED = "false"

    start()

    expect(trackedInterval).not.toHaveBeenCalled()
  })

  it("при неполной конфигурации выключается предупреждением, а не падением плагина", () => {
    delete process.env.REPLICATE_MOCK_MODE
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    try {
      expect(() => start()).not.toThrow()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("конфигурация Replicate неполна"))
      expect(trackedInterval).not.toHaveBeenCalled()
    }
    finally {
      warn.mockRestore()
    }
  })

  it("первый прогон восстановления идёт сразу, не дожидаясь тика таймера", async () => {
    start()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.recoverStalePredictions).toHaveBeenCalledWith(20)
  })
})
