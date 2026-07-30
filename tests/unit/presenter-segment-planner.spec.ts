import { describe, expect, it } from "vitest"

import { planPresenterSegments } from "~~/server/utils/presenter/segment-planner"

describe("presenter segment planner", () => {
  it("режет запись по границам сцен", () => {
    const segments = planPresenterSegments({
      durationSec: 20,
      sceneBoundaries: [6, 13],
    })
    expect(segments.map(s => [s.startSec, s.endSec])).toEqual([
      [0, 6],
      [6, 13],
      [13, 20],
    ])
  })

  it("выбрасывает куски короче минимума", () => {
    const segments = planPresenterSegments({
      durationSec: 12,
      sceneBoundaries: [1.2, 4, 5.1],
    })
    // 0-1.2 и 4-5.1 короче 2 секунд и не годятся для Kling.
    expect(segments.map(s => [s.startSec, s.endSec])).toEqual([
      [1.2, 4],
      [5.1, 12],
    ])
  })

  it("разбивает длинный кусок на равные части не длиннее максимума", () => {
    const segments = planPresenterSegments({
      durationSec: 25,
      sceneBoundaries: [],
    })
    expect(segments).toHaveLength(3)
    for (const segment of segments) {
      expect(segment.durationSec).toBeGreaterThanOrEqual(2)
      expect(segment.durationSec).toBeLessThanOrEqual(10)
    }
    expect(segments[0]!.startSec).toBe(0)
    expect(segments.at(-1)!.endSec).toBe(25)
  })

  it("не оставляет огрызок короче минимума при разбиении", () => {
    // 21 секунда: наивное деление по 10 дало бы хвост в 1 секунду.
    const segments = planPresenterSegments({ durationSec: 21, sceneBoundaries: [] })
    expect(segments).toHaveLength(3)
    for (const segment of segments) {
      expect(segment.durationSec).toBeGreaterThanOrEqual(2)
    }
  })

  it("уважает свои границы длительности", () => {
    const segments = planPresenterSegments({
      durationSec: 30,
      sceneBoundaries: [],
      minDurationSec: 3,
      maxDurationSec: 5,
    })
    for (const segment of segments) {
      expect(segment.durationSec).toBeGreaterThanOrEqual(3)
      expect(segment.durationSec).toBeLessThanOrEqual(5)
    }
  })

  it("подрезает края склейки, чтобы переход не попал в клип", () => {
    const segments = planPresenterSegments({
      durationSec: 20,
      sceneBoundaries: [10],
      paddingSec: 0.25,
    })
    expect(segments[0]!.endSec).toBe(9.75)
    expect(segments[1]!.startSec).toBe(10.25)
  })

  it("помечает, из какой границы сцены вырос сегмент", () => {
    const segments = planPresenterSegments({ durationSec: 16, sceneBoundaries: [8] })
    expect(segments[0]!.sourceBoundaryIndex).toBe(0)
    expect(segments[1]!.sourceBoundaryIndex).toBe(1)
  })

  it("возвращает пусто на слишком коротком или битом входе", () => {
    expect(planPresenterSegments({ durationSec: 1.4, sceneBoundaries: [] })).toEqual([])
    expect(planPresenterSegments({ durationSec: 0, sceneBoundaries: [] })).toEqual([])
    expect(planPresenterSegments({ durationSec: Number.NaN, sceneBoundaries: [] })).toEqual([])
  })

  it("игнорирует мусорные границы вне диапазона и дубли", () => {
    const segments = planPresenterSegments({
      durationSec: 20,
      sceneBoundaries: [-5, 0, 10, 10, 20, 99, Number.NaN],
    })
    expect(segments.map(s => [s.startSec, s.endSec])).toEqual([
      [0, 10],
      [10, 20],
    ])
  })
})
