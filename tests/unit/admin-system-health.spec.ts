/**
 * Реестр фоновых задач и проверка интеграций.
 *
 * Проверяем:
 *   1. Тик отмечается, ошибка тика не отменяет сам тик
 *   2. Просроченной задача становится после двух интервалов, не раньше
 *   3. Мок-режим и отсутствие ключа — разные состояния, и наружу никто не ходит
 *
 * Наружу тесты не ходят вообще: проверка с настоящим ключом — это сеть и
 * чужой сервис, ей не место в юнит-прогоне.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  getSchedulerStats,
  markSchedulerTick,
  registerScheduler,
} from "../../server/utils/scheduler-registry"
import { checkIntegrations } from "../../server/utils/integrations/health"

describe("реестр планировщиков", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T12:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("отмечает тик и считает их", () => {
    registerScheduler("t-ticks", "Тестовая задача", 60_000)
    markSchedulerTick("t-ticks")
    markSchedulerTick("t-ticks")

    const entry = getSchedulerStats().schedulers.find(s => s.key === "t-ticks")
    expect(entry?.tickCount).toBe(2)
    expect(entry?.lastTickAt).not.toBeNull()
    expect(entry?.lastError).toBeNull()
  })

  it("ошибка тика не отменяет сам тик", () => {
    registerScheduler("t-error", "Задача с отказом", 60_000)
    markSchedulerTick("t-error", new Error("провайдер не ответил"))

    const entry = getSchedulerStats().schedulers.find(s => s.key === "t-error")
    // Задача жива — она отработала; не удалась её работа, и это разные аварии
    expect(entry?.tickCount).toBe(1)
    expect(entry?.errorCount).toBe(1)
    expect(entry?.lastError).toBe("провайдер не ответил")
    expect(entry?.lastOkAt).toBeNull()
  })

  it("успешный тик снимает прошлую ошибку", () => {
    registerScheduler("t-recover", "Задача, которая починилась", 60_000)
    markSchedulerTick("t-recover", new Error("сеть"))
    markSchedulerTick("t-recover")

    const entry = getSchedulerStats().schedulers.find(s => s.key === "t-recover")
    expect(entry?.lastError).toBeNull()
    expect(entry?.lastOkAt).not.toBeNull()
  })

  it("просроченной задача становится после двух интервалов", () => {
    registerScheduler("t-overdue", "Задача раз в минуту", 60_000)
    markSchedulerTick("t-overdue")

    // Один пропущенный интервал — нормальный дрейф таймера под нагрузкой
    vi.setSystemTime(new Date("2026-08-06T12:01:30Z"))
    expect(getSchedulerStats().schedulers.find(s => s.key === "t-overdue")?.overdue).toBe(false)

    vi.setSystemTime(new Date("2026-08-06T12:03:00Z"))
    expect(getSchedulerStats().schedulers.find(s => s.key === "t-overdue")?.overdue).toBe(true)
  })

  it("тик по незарегистрированному ключу ничего не ломает", () => {
    expect(() => markSchedulerTick("нет-такой")).not.toThrow()
  })
})

describe("проверка интеграций", () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it("мок-режим и отсутствие ключа — разные состояния", async () => {
    process.env.ANTHROPIC_MOCK_MODE = "true"
    process.env.ANTHROPIC_API_KEY = "sk-should-not-be-used"
    delete process.env.APIFY_TOKEN

    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const result = await checkIntegrations()

    const anthropic = result.services.find(s => s.key === "anthropic")
    expect(anthropic?.state).toBe("mock")

    const apify = result.services.find(s => s.key === "apify")
    expect(apify?.state).toBe("not_configured")

    // Ни один из этих случаев не должен ходить наружу
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("хранилище проверяется локально и попадает в список", async () => {
    const result = await checkIntegrations()
    const storage = result.services.find(s => s.key === "storage")
    expect(storage).toBeDefined()
    expect(result.total).toBe(result.services.length)
  })
})
