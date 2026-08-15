/**
 * Регрессия: список клипов адресуется ПОЗИЦИЕЙ СЦЕНЫ, а не порядком появления файлов.
 *
 * Дефект (ролик 23): `runClipGeneration` не делает клип сценам ведущей и складывает
 * пути подряд — 6 путей на 9 сцен. При этом все потребители (lip-sync, озвучка,
 * субтитры) адресуют клип ИНДЕКСОМ СЦЕНЫ в порядке нарезки (0..8). Из-за этого
 *   • `updatedClipPaths[sceneIndex] = ...` клал клип сцены на место ЧУЖОЙ сцены;
 *   • сцены с индексом ≥ длины списка молча выпадали
 *     («индекс клипа 6 вне списка из 6 путей»);
 *   • реплика ложилась на старт чужого клипа — речь рвалась на склейке.
 *
 * Контракт после правки: длина `clipPaths` равна числу сцен, у сцены без
 * собственного клипа — пустая ячейка. Тогда `clipPaths[sceneIndex]` верен по
 * построению, а пустые ячейки выбрасываются ровно один раз — перед склейкой.
 */

import { describe, expect, it } from "vitest"
import {
  compactSceneClipPaths,
  restoreSceneIndexedClipPaths,
} from "../../../server/utils/presenter/scene-clip-mapping"

describe("restoreSceneIndexedClipPaths: снапшот старого формата разворачивается по сценам", () => {
  it("плотный список из 6 путей на 9 сцен раскладывается по позициям сцен", () => {
    const dense = ["c0.mp4", "c2.mp4", "c3.mp4", "c5.mp4", "c6.mp4", "c8.mp4"]

    const restored = restoreSceneIndexedClipPaths(dense, 9, [1, 4, 7])

    expect(restored).toEqual([
      "c0.mp4", "", "c2.mp4", "c3.mp4", "", "c5.mp4", "c6.mp4", "", "c8.mp4",
    ])
  })

  it("список нужной длины возвращается как есть — он уже по сценам", () => {
    const byScene = ["a.mp4", "", "c.mp4"]

    expect(restoreSceneIndexedClipPaths(byScene, 3, [1])).toEqual(byScene)
  })

  it("сцен ведущей нет — плотный список и есть список по сценам", () => {
    expect(restoreSceneIndexedClipPaths(["a.mp4", "b.mp4"], 2, [])).toEqual(["a.mp4", "b.mp4"])
  })

  it("арифметика не сходится — null, чтобы шаг пересобрал список, а не гадал", () => {
    // 4 пути + 3 сцены ведущей ≠ 9 сцен: какая ячейка чья — неизвестно.
    expect(restoreSceneIndexedClipPaths(["a.mp4", "b.mp4", "c.mp4", "d.mp4"], 9, [1, 4, 7])).toBeNull()
  })
})

describe("compactSceneClipPaths: перед склейкой пустые ячейки выбрасываются", () => {
  it("клипы идут подряд, а карта переносит индекс сцены на позицию в склейке", () => {
    const result = compactSceneClipPaths(["a.mp4", "", "c.mp4", "d.mp4", ""])

    expect(result.clips).toEqual(["a.mp4", "c.mp4", "d.mp4"])
    expect([...result.positionBySceneIndex]).toEqual([[0, 0], [2, 1], [3, 2]])
    expect(result.missingSceneIndexes).toEqual([1, 4])
  })

  it("пробельный путь считается дырой, а не клипом", () => {
    const result = compactSceneClipPaths(["  ", "b.mp4"])

    expect(result.clips).toEqual(["b.mp4"])
    expect(result.missingSceneIndexes).toEqual([0])
  })

  it("сплошной список не меняется", () => {
    const result = compactSceneClipPaths(["a.mp4", "b.mp4"])

    expect(result.clips).toEqual(["a.mp4", "b.mp4"])
    expect(result.missingSceneIndexes).toEqual([])
    expect([...result.positionBySceneIndex]).toEqual([[0, 0], [1, 1]])
  })
})
