import { describe, expect, it } from "vitest"

import { mergeUnrenderableShots } from "~~/server/utils/video-tools/shot-compose"

interface S { order: number, startSec: number, endSec: number, ok: boolean }
const s = (order: number, startSec: number, endSec: number, ok = true): S => ({ order, startSec, endSec, ok })
const renderable = (x: S) => x.ok

describe("слияние кадров, которые нечем нарисовать", () => {
  it("все кадры рисуемы — таймлайн не меняется ни на кадр", () => {
    const input = [s(0, 0, 2), s(1, 2, 4), s(2, 4, 6)]
    const { shots, mergedOrders } = mergeUnrenderableShots(input, renderable)
    expect(shots).toEqual(input)
    expect(mergedOrders).toEqual([])
  })

  it("нерисуемый кадр в середине прирастает к ПРЕДЫДУЩЕМУ — дыры не остаётся", () => {
    const { shots, mergedOrders } = mergeUnrenderableShots([s(0, 0, 2), s(1, 2, 4, false), s(2, 4, 6)], renderable)
    expect(shots.map(x => [x.startSec, x.endSec])).toEqual([[0, 4], [4, 6]])
    expect(mergedOrders).toEqual([1])
  })

  it("нерисуемый ПЕРВЫЙ кадр прирастает к следующему — начало трека покрыто", () => {
    const { shots } = mergeUnrenderableShots([s(0, 0, 2, false), s(1, 2, 4)], renderable)
    expect(shots.map(x => [x.startSec, x.endSec])).toEqual([[0, 4]])
  })

  it("нерисуемый последний кадр прирастает к предыдущему — хвост покрыт", () => {
    const { shots } = mergeUnrenderableShots([s(0, 0, 2), s(1, 2, 4, false)], renderable)
    expect(shots.map(x => [x.startSec, x.endSec])).toEqual([[0, 4]])
  })

  it("подряд идущие нерисуемые сливаются в одного соседа, а не размножаются", () => {
    const { shots, mergedOrders } = mergeUnrenderableShots(
      [s(0, 0, 2), s(1, 2, 4, false), s(2, 4, 6, false), s(3, 6, 8)], renderable,
    )
    expect(shots.map(x => [x.startSec, x.endSec])).toEqual([[0, 6], [6, 8]])
    expect(mergedOrders).toEqual([1, 2])
  })

  it("покрытие сохраняется всегда: сумма длительностей и границы не меняются", () => {
    const input = [s(0, 0, 1.5, false), s(1, 1.5, 3.3), s(2, 3.3, 5.0, false), s(3, 5.0, 7.2)]
    const { shots } = mergeUnrenderableShots(input, renderable)
    expect(shots[0]!.startSec).toBe(0)
    expect(shots.at(-1)!.endSec).toBe(7.2)
    for (let i = 1; i < shots.length; i += 1) expect(shots[i]!.startSec).toBe(shots[i - 1]!.endSec)
  })

  it("ни одного рисуемого кадра нет — возвращается пустой список, решение принимает вызывающий", () => {
    const { shots } = mergeUnrenderableShots([s(0, 0, 2, false), s(1, 2, 4, false)], renderable)
    expect(shots).toEqual([])
  })
})
