/**
 * Unit-тесты generateBulkSchedule + validateMinInterval + validateScheduledInWindow.
 *
 * Покрытие:
 *   - Детерминированность (одинаковый seed → одинаковое расписание)
 *   - MIN_INTERVAL соблюдается per account
 *   - 5-минутные слоты (округление)
 *   - Окно [start, end] не нарушается
 *   - Unscheduled при тесном окне
 *   - Validate функции находят нарушения
 */
import { describe, expect, it } from "vitest"

import {
  BULK_PAIRS_LIMIT,
  generateBulkSchedule,
  MIN_INTERVAL_MS,
  SLOT_MS,
  validateMinInterval,
  validateScheduledInWindow,
} from "../../server/utils/posting/bulk-scheduling"

const HOUR_MS = 60 * 60 * 1000

describe("generateBulkSchedule", () => {
  it("happy path: 3 пары на 2 аккаунта в окне 24ч → все scheduled", () => {
    const now = Date.UTC(2026, 4, 22, 0, 0, 0)
    const result = generateBulkSchedule({
      pairs: [
        { socialAccountId: 1, videoId: 10 },
        { socialAccountId: 1, videoId: 11 },
        { socialAccountId: 2, videoId: 10 },
      ],
      windowStartMs: now + HOUR_MS,
      windowEndMs: now + 24 * HOUR_MS,
      seed: "test-1",
    })
    expect(result.scheduled).toHaveLength(3)
    expect(result.unscheduled).toHaveLength(0)
  })

  it("детерминированность: одинаковый seed → одинаковый результат", () => {
    const input = {
      pairs: [
        { socialAccountId: 1, videoId: 10 },
        { socialAccountId: 1, videoId: 11 },
        { socialAccountId: 2, videoId: 10 },
      ],
      windowStartMs: Date.UTC(2026, 4, 22, 1, 0, 0),
      windowEndMs: Date.UTC(2026, 4, 23, 0, 0, 0),
      seed: "deterministic",
    }
    const a = generateBulkSchedule(input)
    const b = generateBulkSchedule(input)
    expect(a.scheduled).toEqual(b.scheduled)
  })

  it("MIN_INTERVAL: 3 пары на 1 аккаунт в окне 24ч с min=4ч → разнесены ≥4ч", () => {
    const result = generateBulkSchedule({
      pairs: [
        { socialAccountId: 1, videoId: 10 },
        { socialAccountId: 1, videoId: 11 },
        { socialAccountId: 1, videoId: 12 },
      ],
      windowStartMs: Date.UTC(2026, 4, 22, 0, 0, 0),
      windowEndMs: Date.UTC(2026, 4, 22, 24, 0, 0),
      minIntervalMs: 4 * HOUR_MS,
      seed: "min-interval",
    })
    expect(result.scheduled).toHaveLength(3)
    const times = result.scheduled
      .filter((s) => s.socialAccountId === 1)
      .map((s) => new Date(s.scheduledAt).getTime())
      .sort((a, b) => a - b)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(4 * HOUR_MS)
    }
  })

  it("MIN_INTERVAL вытесняет: 5 пар на 1 аккаунт в окне 10ч с min=4ч → 3 scheduled + 2 unscheduled", () => {
    const result = generateBulkSchedule({
      pairs: [
        { socialAccountId: 1, videoId: 10 },
        { socialAccountId: 1, videoId: 11 },
        { socialAccountId: 1, videoId: 12 },
        { socialAccountId: 1, videoId: 13 },
        { socialAccountId: 1, videoId: 14 },
      ],
      windowStartMs: Date.UTC(2026, 4, 22, 0, 0, 0),
      windowEndMs: Date.UTC(2026, 4, 22, 10, 0, 0),
      minIntervalMs: 4 * HOUR_MS,
      seed: "tight-window",
    })
    expect(result.scheduled.length + result.unscheduled.length).toBe(5)
    expect(result.scheduled.length).toBeLessThanOrEqual(3)
  })

  it("5-минутные слоты: все scheduledAt % SLOT_MS = 0", () => {
    const result = generateBulkSchedule({
      pairs: [
        { socialAccountId: 1, videoId: 10 },
        { socialAccountId: 2, videoId: 11 },
        { socialAccountId: 3, videoId: 12 },
      ],
      windowStartMs: Date.UTC(2026, 4, 22, 0, 0, 0),
      windowEndMs: Date.UTC(2026, 4, 22, 12, 0, 0),
      seed: "slot-test",
    })
    for (const s of result.scheduled) {
      const t = new Date(s.scheduledAt).getTime()
      expect(t % SLOT_MS).toBe(0)
    }
  })

  it("окно: все scheduledAt ∈ [windowStart, windowEnd]", () => {
    const windowStart = Date.UTC(2026, 4, 22, 0, 0, 0)
    const windowEnd = Date.UTC(2026, 4, 22, 24, 0, 0)
    const result = generateBulkSchedule({
      pairs: Array.from({ length: 10 }, (_, i) => ({
        socialAccountId: (i % 3) + 1,
        videoId: 100 + i,
      })),
      windowStartMs: windowStart,
      windowEndMs: windowEnd,
      seed: "window-test",
    })
    for (const s of result.scheduled) {
      const t = new Date(s.scheduledAt).getTime()
      expect(t).toBeGreaterThanOrEqual(windowStart)
      expect(t).toBeLessThanOrEqual(windowEnd)
    }
  })

  it("windowStart >= windowEnd → все unscheduled", () => {
    const t = Date.UTC(2026, 4, 22, 0, 0, 0)
    const result = generateBulkSchedule({
      pairs: [{ socialAccountId: 1, videoId: 10 }],
      windowStartMs: t,
      windowEndMs: t,
      seed: "zero-window",
    })
    expect(result.scheduled).toHaveLength(0)
    expect(result.unscheduled).toHaveLength(1)
  })

  it("пустой массив pairs → пустой результат", () => {
    const result = generateBulkSchedule({
      pairs: [],
      windowStartMs: Date.now(),
      windowEndMs: Date.now() + HOUR_MS,
      seed: "empty",
    })
    expect(result.scheduled).toHaveLength(0)
    expect(result.unscheduled).toHaveLength(0)
  })
})

describe("validateMinInterval", () => {
  it("пустой массив → null (нарушений нет)", () => {
    expect(validateMinInterval([])).toBeNull()
  })

  it("один pair → null", () => {
    expect(
      validateMinInterval([
        { socialAccountId: 1, videoId: 10, scheduledAt: new Date().toISOString() },
      ]),
    ).toBeNull()
  })

  it("два pair одного account с интервалом < MIN_INTERVAL → conflict", () => {
    const now = Date.now()
    const result = validateMinInterval([
      { socialAccountId: 1, videoId: 10, scheduledAt: new Date(now).toISOString() },
      {
        socialAccountId: 1,
        videoId: 11,
        scheduledAt: new Date(now + HOUR_MS).toISOString(),
      },
    ])
    expect(result).not.toBeNull()
    expect(result?.accountId).toBe(1)
  })

  it("два pair разных аккаунтов с любым интервалом → null", () => {
    const now = Date.now()
    expect(
      validateMinInterval([
        {
          socialAccountId: 1,
          videoId: 10,
          scheduledAt: new Date(now).toISOString(),
        },
        {
          socialAccountId: 2,
          videoId: 11,
          scheduledAt: new Date(now + 60_000).toISOString(),
        },
      ]),
    ).toBeNull()
  })

  it("invalid date → conflict", () => {
    expect(
      validateMinInterval([
        { socialAccountId: 1, videoId: 10, scheduledAt: "not-a-date" },
      ]),
    ).not.toBeNull()
  })
})

describe("validateScheduledInWindow", () => {
  it("все в окне → null", () => {
    const start = Date.UTC(2026, 4, 22, 0, 0, 0)
    const end = Date.UTC(2026, 4, 22, 24, 0, 0)
    expect(
      validateScheduledInWindow(
        [
          {
            socialAccountId: 1,
            videoId: 10,
            scheduledAt: new Date(start + HOUR_MS).toISOString(),
          },
        ],
        start,
        end,
      ),
    ).toBeNull()
  })

  it("за пределами → возвращает оффлайн pair", () => {
    const start = Date.UTC(2026, 4, 22, 0, 0, 0)
    const end = Date.UTC(2026, 4, 22, 24, 0, 0)
    const result = validateScheduledInWindow(
      [
        {
          socialAccountId: 1,
          videoId: 10,
          scheduledAt: new Date(start - HOUR_MS).toISOString(),
        },
      ],
      start,
      end,
    )
    expect(result).not.toBeNull()
    expect(result?.socialAccountId).toBe(1)
  })
})

describe("BULK_PAIRS_LIMIT constant", () => {
  it("равен 50", () => {
    expect(BULK_PAIRS_LIMIT).toBe(50)
  })
})

describe("MIN_INTERVAL_MS constant", () => {
  it("равен 4 часам", () => {
    expect(MIN_INTERVAL_MS).toBe(4 * HOUR_MS)
  })
})
