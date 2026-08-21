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

  it("даёт окно на записи ровно требуемой длины, невыровненной по кадру", () => {
    // recordingDurationSec === requiredSec, но ни то ни другое не кратно 1/30.
    // Конец окна, округлённый вверх, вылезает за запись на 17мс — это меньше
    // кадра (33мс), поэтому окно принимается, прижатое к последнему кадру записи.
    const window = planRecordingWindow(base({ recordingDurationSec: 5.017, requiredSec: 5.017 }))

    expect(window).not.toBeNull()
    expect(window!.startSec).toBe(0)
    expect(window!.endSec).toBeCloseTo(5, 3)
    expect(window!.durationSec).toBeCloseTo(5, 3)
    // Недостача — доли кадра, не кадр целиком.
    expect(5.017 - window!.durationSec).toBeLessThan(1 / 30)
  })

  it("даёт окно, когда запись длиннее требуемого на несколько миллисекунд", () => {
    // Раньше здесь тоже уходило в null: округление конца окна к БЛИЖАЙШЕМУ
    // кадру (5.0333) вылезало за фактическую длину записи (5.02) точно так же,
    // хотя запись и длиннее заказанного.
    const window = planRecordingWindow(base({ recordingDurationSec: 5.02, requiredSec: 5.017 }))

    expect(window).not.toBeNull()
    expect(window!.durationSec).toBeCloseTo(5, 3)
  })

  it("отказывает, когда запись короче требуемого больше чем на кадр", () => {
    // Недостача 117мс — заметно больше одного кадра (33мс). Ни одна позиция
    // не проходит допуск, результат честный null.
    expect(planRecordingWindow(base({ recordingDurationSec: 4.9, requiredSec: 5.017 }))).toBeNull()
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

  it("предпочитает нетронутый хвост остывшей голове, а не первую позицию по сканированию", () => {
    // Голова 0-5 занята, но 48 часов назад — cooldown (24ч) давно истёк, она
    // остыла. Хвост 5-10 не тронут вовсе. У обоих overlapSec (по горячим
    // интервалам) одинаково нулевой — до правки при равенстве побеждала первая
    // по сканированию позиция, то есть остывшая голова. Победить обязан хвост.
    const window = planRecordingWindow(base({
      recordingDurationSec: 10,
      requiredSec: 5,
      usedIntervals: [{ startSec: 0, endSec: 5, usedAtMs: NOW - 48 * HOUR }],
    }))!

    expect(window.startSec).toBeGreaterThanOrEqual(5)
    expect(window.overlapSec).toBe(0)
    expect(window.reused).toBe(false)
  })

  it("не отравляется интервалом с нечисловыми границами", () => {
    // startSec: NaN — overlap() с ним даёт NaN, и без фильтра первый же
    // кандидат намертво застревает в best, хотя вся запись за вычетом мусорного
    // интервала свободна.
    const window = planRecordingWindow(base({
      recordingDurationSec: 20,
      requiredSec: 5,
      usedIntervals: [{ startSec: Number.NaN, endSec: 5, usedAtMs: NOW - HOUR }],
    }))!

    expect(window.overlapSec).toBe(0)
    expect(window.reused).toBe(false)
  })
})
