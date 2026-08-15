/**
 * Сцены ведущей адресуются order'ом, а не позицией в плане.
 *
 * `video-pipeline.ts` собирал набор как ПОЗИЦИИ в `videoPlan.scenes`
 * (`presenterSceneIndexes.add(index)`), а `runClipGeneration` спрашивал у него
 * `has(scene.order)`. Разные пространства чисел: при order'ах 1..9 сцены
 * ведущей дают позиции {0,3,6,8}, и шаг клипов пропускал сцены с order 3, 6, 8
 * — то есть НЕ ведущей, — а для настоящих сцен ведущей (order 1,4,7,9) платно
 * генерировал клипы, которые тут же выбрасывались.
 *
 * Отсюда же росли «индекс клипа 6 вне списка из 5 путей», дубль сцены и
 * четыре сцены, не дошедшие до сборки.
 */

import { describe, expect, it } from "vitest"
import {
  presenterSceneOrdersFrom,
  sceneOrdersByIndexes,
} from "~~/server/utils/presenter/presenter-scenes"

const plan = [
  { order: 1, spokenLine: "Реплика" },
  { order: 2, spokenLine: null },
  { order: 3, spokenLine: "   " },
  { order: 4, spokenLine: "Ещё реплика" },
  { order: 5, spokenLine: undefined },
]

describe("presenterSceneOrdersFrom", () => {
  it("отдаёт order'ы говорящих сцен, а не их позиции", () => {
    // Позиции были бы {0, 3} — и именно из-за них шаг клипов пропускал чужие сцены.
    expect([...presenterSceneOrdersFrom(plan)]).toEqual([1, 4])
  })

  it("пустая и пробельная реплика ведущей не считается", () => {
    expect(presenterSceneOrdersFrom(plan).has(3)).toBe(false)
    expect(presenterSceneOrdersFrom(plan).has(2)).toBe(false)
    expect(presenterSceneOrdersFrom(plan).has(5)).toBe(false)
  })

  it("сцена без order в набор не попадает — адресовать её нечем", () => {
    const broken = [{ spokenLine: "Реплика" } as { order?: number, spokenLine: string }]
    expect(presenterSceneOrdersFrom(broken).size).toBe(0)
  })

  it("пустой план — пустой набор", () => {
    expect(presenterSceneOrdersFrom([]).size).toBe(0)
  })
})

describe("sceneOrdersByIndexes", () => {
  it("переводит позиции в order'ы того же плана", () => {
    // Ровно тот случай из ролика 21: позиции {0,3} → order'ы {1,4}, а не {0,3}.
    expect([...sceneOrdersByIndexes(plan, new Set([0, 3]))]).toEqual([1, 4])
  })

  it("позиция за пределами плана отбрасывается", () => {
    expect([...sceneOrdersByIndexes(plan, new Set([0, 99]))]).toEqual([1])
  })

  it("пустой набор остаётся пустым", () => {
    expect(sceneOrdersByIndexes(plan, new Set()).size).toBe(0)
  })
})
