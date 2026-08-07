/**
 * Модель пропускной способности под требование «до 300 роликов в сутки»
 * (docs/PROJECT_CONTEXT.md п.3 и п.12). Чистая арифметика, без БД и сети.
 */
import { describe, it, expect } from "vitest"
import {
  calculateCapacity,
  formatCapacityReport,
  type CapacityInput,
  type StageDurationsSec,
} from "~~/server/utils/capacity/throughput-model"

/** Медианы шагов, снятые с canary-прогона 06.08.2026: девять сцен, 80 секунд ролика. */
const CANARY_STAGES: StageDurationsSec = {
  scenario: 300,
  images: 120,
  clips: 900,
  lipSync: 2400,
  voiceover: 180,
  assembly: 120,
}

function input(overrides: Partial<CapacityInput> = {}): CapacityInput {
  return {
    targetPerDay: 300,
    stages: CANARY_STAGES,
    concurrentRuns: 5,
    retryRate: 0.2,
    accountQuotas: [50, 50, 50, 50, 50, 50],
    publicationsPerVideo: 1,
    ...overrides,
  }
}

describe("модель пропускной способности", () => {
  it("на текущих настройках цель в 300 роликов не достигается и виновата генерация", () => {
    const report = calculateCapacity(input())

    expect(report.meetsTarget).toBe(false)
    expect(report.bottleneck.kind).toBe("generation")
    // 4020 секунд на ролик при пяти параллельных — примерно сотня прогонов в сутки,
    // из них готовыми выходит меньше с учётом переделок.
    expect(report.generationPerDay).toBeLessThan(120)
    expect(report.requiredConcurrency).toBeGreaterThan(5)
  })

  it("считает, сколько параллельных прогонов закрыло бы цель", () => {
    const params = input()
    const report = calculateCapacity(params)

    // Проверяем, что рекомендация самосогласована: с ней цель по генерации закрывается.
    const withRecommended = calculateCapacity({
      ...params,
      concurrentRuns: report.requiredConcurrency,
      // квоты не ограничивают — смотрим ровно на генерацию
      accountQuotas: Array.from({ length: 40 }, () => 50),
    })
    expect(withRecommended.generationPerDay).toBeGreaterThanOrEqual(params.targetPerDay)
  })

  it("при быстрой генерации упирается публикация, а не конвейер", () => {
    const report = calculateCapacity(input({
      stages: { scenario: 30, images: 10, clips: 60, lipSync: 60, voiceover: 20, assembly: 10 },
      concurrentRuns: 20,
      accountQuotas: [50, 50],
    }))

    expect(report.bottleneck.kind).toBe("publishing")
    expect(report.publishingVideosPerDay).toBe(100)
    expect(report.achievablePerDay).toBe(100)
  })

  it("кросспостинг делит квоту: один ролик на три площадки втрое дороже по слотам", () => {
    const single = calculateCapacity(input({ publicationsPerVideo: 1 }))
    const triple = calculateCapacity(input({ publicationsPerVideo: 3 }))

    expect(single.publishingVideosPerDay).toBe(300)
    expect(triple.publishingVideosPerDay).toBe(100)
  })

  it("считает нехватку аккаунтов по средней квоте", () => {
    const report = calculateCapacity(input({
      accountQuotas: [50, 50],
      publicationsPerVideo: 1,
    }))

    // 300 публикаций нужно, 100 есть, средняя квота 50 → не хватает четырёх аккаунтов.
    expect(report.missingAccounts).toBe(4)
  })

  it("переделки уменьшают выход готовых роликов, а не число запусков", () => {
    const clean = calculateCapacity(input({ retryRate: 0 }))
    const dirty = calculateCapacity(input({ retryRate: 1 }))

    expect(dirty.generationPerDay).toBeLessThan(clean.generationPerDay)
    // Стопроцентная доля переделок ровно вдвое режет выход.
    expect(dirty.generationPerDay).toBe(Math.floor(clean.generationPerDay / 2))
  })

  it("не делит на ноль при пустых аккаунтах и мусорных входах", () => {
    const report = calculateCapacity(input({
      accountQuotas: [],
      concurrentRuns: 0,
      publicationsPerVideo: 0,
    }))

    expect(report.publishingVideosPerDay).toBe(0)
    expect(report.achievablePerDay).toBe(0)
    expect(report.missingAccounts).toBe(0)
    expect(Number.isFinite(report.generationPerDay)).toBe(true)
  })

  it("отчёт называет узкое место словами", () => {
    const params = input()
    const text = formatCapacityReport(params, calculateCapacity(params))

    expect(text).toContain("Цель: 300 роликов в сутки")
    expect(text).toContain("цель НЕ достигается")
    expect(text).toContain("Упирается: генерация")
  })
})
