import { describe, expect, it } from "vitest"

import { alignedScenesByClipPosition } from "~~/server/utils/subtitles/aligned-scene-position"

describe("перевод order сцены в позицию клипа в уплотнённой склейке", () => {
  it("сдвигает индексы, когда в клипах есть дыра (сцена без клипа выпала)", () => {
    // Сцена order=1 клипа не получила (частичная генерация) — compactSceneClipPaths
    // выкинул её и сдвинул сцену order=2 на позицию 1.
    const alignedScenes = [
      { order: 0, startSec: 0, endSec: 1, words: [] },
      { order: 1, startSec: 1, endSec: 2, words: [] },
      { order: 2, startSec: 2, endSec: 3, words: [] },
    ]
    const positionByOrder = new Map([
      [0, 0],
      [2, 1],
      // order=1 в карте нет — клипа для неё не было.
    ])

    const byPosition = alignedScenesByClipPosition(alignedScenes, positionByOrder)

    expect(byPosition.get(0)).toMatchObject({ order: 0 })
    expect(byPosition.get(1)).toMatchObject({ order: 2 })
    // Сцена order=1 клипа не получила — её выровненные слова положить некуда.
    expect(byPosition.has(2)).toBe(false)
    expect(byPosition.size).toBe(2)
  })

  it("оставляет индексы как есть, когда уплотнения не было", () => {
    const alignedScenes = [
      { order: 0, startSec: 0, endSec: 1, words: [] },
      { order: 1, startSec: 1, endSec: 2, words: [] },
      { order: 2, startSec: 2, endSec: 3, words: [] },
    ]
    const positionByOrder = new Map([
      [0, 0],
      [1, 1],
      [2, 2],
    ])

    const byPosition = alignedScenesByClipPosition(alignedScenes, positionByOrder)

    expect(byPosition.get(0)).toMatchObject({ order: 0 })
    expect(byPosition.get(1)).toMatchObject({ order: 1 })
    expect(byPosition.get(2)).toMatchObject({ order: 2 })
    expect(byPosition.size).toBe(3)
  })
})
