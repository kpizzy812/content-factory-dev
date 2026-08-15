/**
 * Сопоставление сцен с клипами, когда часть сцен отдана ведущей.
 *
 * Порядок клипов брался из снапшота `prompt_generation` — там перечислены ВСЕ
 * сцены, которым сочинили промпт. Но `clip_generation` сцены ведущей
 * пропускает: под них клип не генерируется и не должен. В итоге карта
 * «сцена → индекс клипа» указывала за пределы массива:
 *
 *   Сцена order=7: индекс клипа 6 вне списка из 5 путей
 *   Сцена order=9: индекс клипа 8 вне списка из 5 путей
 *
 * Ролик 21: план 9 сцен, в сборку ушло 5. Четыре сцены выпали молча.
 *
 * Недостающее знание лежало рядом: шаг клипов пишет `presenterSceneIndexes` —
 * order'ы сцен, отданных ведущей. Их и надо вычесть.
 */

import { describe, expect, it } from "vitest"
import {
  buildSceneClipIndexMap,
} from "~~/server/utils/presenter/scene-clip-mapping"
import {
  clipSceneOrdersFrom,
} from "~~/server/utils/presenter/clip-scene-orders"

const promptSnapshot = {
  scenePrompts: { scenes: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(order => ({ order })) },
}

describe("порядок клипов исключает сцены ведущей", () => {
  it("вычитает отданные ведущей order'ы", () => {
    const clipSnapshot = { presenterSceneIndexes: [1, 4, 7, 9] }
    expect(clipSceneOrdersFrom(promptSnapshot, clipSnapshot)).toEqual([2, 3, 5, 6, 8])
  })

  it("карта сцен ложится в реальную длину clipPaths", () => {
    const orders = clipSceneOrdersFrom(promptSnapshot, { presenterSceneIndexes: [1, 4, 7, 9] })!
    const scenes = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(order => ({ order }))
    const map = buildSceneClipIndexMap(scenes, orders, { allowPositionalFallback: false })

    // Пять сгенерированных клипов — пять индексов, все внутри массива.
    expect([...map.values()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
    // Сцены ведущей клипа не имеют вовсе — им его создаёт шаг lip-sync.
    for (const order of [1, 4, 7, 9]) expect(map.has(order)).toBe(false)
  })

  it("без сцен ведущей порядок не меняется", () => {
    expect(clipSceneOrdersFrom(promptSnapshot, { presenterSceneIndexes: [] }))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it("снапшота клипов нет — отдаём порядок промптов как раньше", () => {
    // Старые ролики и прогоны без шага клипов: вычитать нечего, а ломать
    // прежнее поведение из-за отсутствия данных нельзя.
    expect(clipSceneOrdersFrom(promptSnapshot, null))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(clipSceneOrdersFrom(promptSnapshot, {}))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it("нет снапшота промптов — нет и карты", () => {
    expect(clipSceneOrdersFrom(null, { presenterSceneIndexes: [1] })).toBeNull()
  })

  it("мусор в presenterSceneIndexes игнорируется, а не роняет карту", () => {
    const orders = clipSceneOrdersFrom(promptSnapshot, {
      presenterSceneIndexes: [1, "два", null, 4],
    })
    expect(orders).toEqual([2, 3, 5, 6, 7, 8, 9])
  })
})
