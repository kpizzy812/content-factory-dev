/**
 * balance_v2 burn-rate: integration-style тесты против test-БД.
 *
 * Используем уникальные service-tag'и (`__burnrate_test_*`) чтобы быть устойчивым
 * к чужим записям AiAuditLog от других spec, которые могут писать в `fal.ai`/`anthropic`
 * и оставаться в окне TRUNCATE-cycle. afterEach из setup.ts всё равно TRUNCATE'ет,
 * но между тестами разных spec может быть race-окно. Uniqueness — простая защита.
 *
 * Покрытие:
 *   1. empty AiAuditLog → dailyAvgUsd=0, projectedZeroDate=undefined
 *   2. 7 записей по $1 за последние 7 дней → dailyAvgUsd ≈ $1
 *   3. baseline $50, dailyAvg $5 → projectedZeroDate ≈ now + 10 дней (±1 час)
 *   4. windowDays=14 — только записи за последние 14 дней учитываются
 */

import { describe, it, expect } from "vitest"
import { prisma } from "../../server/utils/prisma"
import { computeBurnRate } from "../../server/utils/balance/burn-rate"

const DAY_MS = 86_400_000

async function insertCostEntry(service: string, costUsd: number, daysAgo: number) {
  await prisma.aiAuditLog.create({
    data: {
      action: "external_api_call",
      model: `${service}-model`,
      service,
      costUsd,
      status: "applied",
      createdAt: new Date(Date.now() - daysAgo * DAY_MS),
    },
  })
}

describe("computeBurnRate", () => {
  it("empty AiAuditLog → dailyAvgUsd=0, projectedZeroDate=undefined", async () => {
    const br = await computeBurnRate("__burnrate_empty", 100)
    expect(br.dailyAvgUsd).toBe(0)
    expect(br.windowDays).toBe(7)
    expect(br.projectedZeroDate).toBeUndefined()
  })

  it("7 записей по $1 за последние 7 дней → dailyAvgUsd ≈ $1", async () => {
    const tag = "__burnrate_7d"
    for (let i = 0; i < 7; i++) {
      await insertCostEntry(tag, 1, i)
    }
    const br = await computeBurnRate(tag, null)
    expect(br.dailyAvgUsd).toBeCloseTo(1, 6)
    expect(br.windowDays).toBe(7)
    expect(br.projectedZeroDate).toBeUndefined()
  })

  it("baseline $50, dailyAvg $5 → projectedZeroDate ≈ now + 10 дней", async () => {
    const tag = "__burnrate_projected"
    for (let i = 0; i < 7; i++) {
      await insertCostEntry(tag, 5, i)
    }
    const br = await computeBurnRate(tag, 50)
    expect(br.dailyAvgUsd).toBeCloseTo(5, 6)
    expect(br.projectedZeroDate).toBeDefined()
    const expectedZeroAt = Date.now() + 10 * DAY_MS
    const actualZeroAt = new Date(br.projectedZeroDate!).getTime()
    expect(Math.abs(actualZeroAt - expectedZeroAt)).toBeLessThan(60 * 60 * 1000)
  })

  it("windowDays=14 — записи старше 14 дней не учитываются", async () => {
    const tag = "__burnrate_window14"
    for (let i = 0; i < 5; i++) {
      await insertCostEntry(tag, 7, i * 2)
    }
    await insertCostEntry(tag, 100, 15)
    await insertCostEntry(tag, 100, 20)
    await insertCostEntry(tag, 100, 30)
    const br = await computeBurnRate(tag, null, 14)
    expect(br.windowDays).toBe(14)
    expect(br.dailyAvgUsd).toBeCloseTo(2.5, 6)
  })

  it("разные service не суммируются", async () => {
    await insertCostEntry("__burnrate_fal", 10, 0)
    await insertCostEntry("__burnrate_anth", 100, 0)
    await insertCostEntry("__burnrate_mubert", 50, 0)
    const fal = await computeBurnRate("__burnrate_fal", null)
    expect(fal.dailyAvgUsd).toBeCloseTo(10 / 7, 6)
    const anth = await computeBurnRate("__burnrate_anth", null)
    expect(anth.dailyAvgUsd).toBeCloseTo(100 / 7, 6)
  })

  it("dailyAvgUsd=0 → projectedZeroDate undefined даже при baseline > 0", async () => {
    const br = await computeBurnRate("__burnrate_zero", 50)
    expect(br.dailyAvgUsd).toBe(0)
    expect(br.projectedZeroDate).toBeUndefined()
  })
})
