import { describe, expect, it } from "vitest"

import { planRecordingWindow } from "~~/server/utils/presenter/recording-window"

const HOUR = 60 * 60 * 1000
const NOW = 1_700_000_000_000

function base(overrides: Record<string, unknown> = {}) {
  return {
    recordingDurationSec: 100,
    requiredSec: 5,
    fps: 30,
    usedIntervals: [],
    now: NOW,
    ...overrides,
  }
}

describe("выбор окна внутри записи ведущего", () => {
  it("даёт окно ровно требуемой длины", () => {
    const window = planRecordingWindow(base())!

    expect(window.durationSec).toBeCloseTo(5, 3)
    expect(window.endSec - window.startSec).toBeCloseTo(5, 3)
  })

  it("притягивает границы к кадру — сборка режет видео по кадрам", () => {
    const window = planRecordingWindow(base({ requiredSec: 4.017 }))!

    expect(Math.abs(window.startSec * 30 - Math.round(window.startSec * 30))).toBeLessThan(1e-6)
    expect(Math.abs(window.endSec * 30 - Math.round(window.endSec * 30))).toBeLessThan(1e-6)
  })

  it("не берёт участок, занятый сегодня, пока есть нетронутый", () => {
    const window = planRecordingWindow(base({
      usedIntervals: [{ startSec: 0, endSec: 20, usedAtMs: NOW - HOUR }],
    }))!

    expect(window.startSec).toBeGreaterThanOrEqual(20)
    expect(window.overlapSec).toBe(0)
    expect(window.reused).toBe(false)
  })

  it("берёт остывший участок, когда нетронутых не осталось", () => {
    // Вся запись занята, но давно: cooldown прошёл, повтор допустим.
    const window = planRecordingWindow(base({
      usedIntervals: [{ startSec: 0, endSec: 100, usedAtMs: NOW - 60 * 24 * HOUR }],
    }))!

    expect(window.reused).toBe(true)
    expect(window.durationSec).toBeCloseTo(5, 3)
  })

  it("при полностью свежем занятии берёт наименее перекрытый участок, а не первый попавшийся", () => {
    const window = planRecordingWindow(base({
      recordingDurationSec: 30,
      requiredSec: 10,
      usedIntervals: [
        { startSec: 0, endSec: 10, usedAtMs: NOW - HOUR },
        { startSec: 10, endSec: 14, usedAtMs: NOW - HOUR },
      ],
    }))!

    // Хвост 20-30 не занят вовсе — он и должен выиграть.
    expect(window.startSec).toBeGreaterThanOrEqual(14)
    expect(window.overlapSec).toBe(0)
  })

  it("отказывает, когда запись короче требуемого окна", () => {
    // Нельзя вернуть окно короче заказанного: кадр стал бы короче звука, а
    // звук — эталон времени.
    expect(planRecordingWindow(base({ recordingDurationSec: 3, requiredSec: 5 }))).toBeNull()
  })

  it("отказывает на бессмысленном входе, а не выдумывает окно", () => {
    expect(planRecordingWindow(base({ requiredSec: 0 }))).toBeNull()
    expect(planRecordingWindow(base({ requiredSec: Number.NaN }))).toBeNull()
    expect(planRecordingWindow(base({ recordingDurationSec: 0 }))).toBeNull()
  })

  it("без fps работает, просто не притягивает границы", () => {
    const window = planRecordingWindow(base({ fps: 0, requiredSec: 4.017 }))!

    expect(window.durationSec).toBeCloseTo(4.017, 3)
  })
})
