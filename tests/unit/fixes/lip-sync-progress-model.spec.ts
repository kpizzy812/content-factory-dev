/**
 * Чистая часть фикса «resume без повторной оплаты»: слияние записей между попытками,
 * разбор порядка клипов из снапшота prompt_generation и окно длительностей исходника
 * ведущего. Всё без БД и сети.
 */

import { describe, expect, it } from "vitest"
import {
  areAllScenesCovered,
  mergeSceneRecords,
  readPreviousSceneRecords,
  type LipSyncSceneRecord,
} from "../../../server/utils/presenter/lip-sync-progress"
import { extractClipSceneOrders } from "../../../server/utils/presenter/clip-scene-orders"
import { buildPresenterDurationWindow } from "../../../server/utils/presenter/duration-window"

function record(sceneIndex: number, outputPath: string): LipSyncSceneRecord {
  return {
    sceneOrder: sceneIndex + 1,
    sceneIndex,
    sourcePath: `/a/scene_${sceneIndex}_clip.mp4`,
    // В проде эту строку брендирует только markLipSynced (lip-sync-runner.ts).
    // Тест конструирует LipSyncSceneRecord напрямую, минуя раннер, — как и
    // в tests/unit/edit-plan/pip-compose.spec.ts.
    outputPath: outputPath as never,
    audioPath: null,
    spokenLineHash: "hash",
    durationSec: 5,
  }
}

describe("readPreviousSceneRecords", () => {
  it("поднимает записи прошлого прогона по sceneIndex", () => {
    const map = readPreviousSceneRecords({ scenes: [record(0, "/a/0.mp4"), record(2, "/a/2.mp4")] })
    expect([...map.keys()]).toEqual([0, 2])
    expect(map.get(2)?.outputPath).toBe("/a/2.mp4")
  })

  it("мусор и отсутствующий снапшот дают пустую карту", () => {
    expect(readPreviousSceneRecords(null).size).toBe(0)
    expect(readPreviousSceneRecords({ scenes: "нет" }).size).toBe(0)
    expect(readPreviousSceneRecords({ scenes: [{ sceneIndex: "1" }] }).size).toBe(0)
  })
})

describe("mergeSceneRecords", () => {
  it("сцены прошлой попытки переживают текущую", () => {
    const previous = readPreviousSceneRecords({ scenes: [record(3, "/a/3.mp4"), record(4, "/a/4.mp4")] })
    const merged = mergeSceneRecords(previous, [record(0, "/a/0.mp4")])
    // Без слияния запись «только своих» стёрла бы готовые сцены 3-4,
    // и следующий прогон оплатил бы их заново.
    expect(merged.map(r => r.sceneIndex)).toEqual([0, 3, 4])
  })

  it("свежая запись побеждает старую по тому же индексу", () => {
    const previous = readPreviousSceneRecords({ scenes: [record(1, "/a/old.mp4")] })
    const merged = mergeSceneRecords(previous, [record(1, "/a/new.mp4")])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.outputPath).toBe("/a/new.mp4")
  })
})

describe("areAllScenesCovered", () => {
  it("кэш отдаём только когда покрыты все целевые сцены", () => {
    const records = readPreviousSceneRecords({ scenes: [record(0, "/a/0.mp4")] })
    expect(areAllScenesCovered([0], records)).toBe(true)
    expect(areAllScenesCovered([0, 1], records)).toBe(false)
    expect(areAllScenesCovered([], records)).toBe(false)
  })
})

describe("extractClipSceneOrders", () => {
  it("достаёт порядок сцен из снапшота prompt_generation", () => {
    const orders = extractClipSceneOrders({
      scenePrompts: { scenes: [{ order: 1 }, { order: 2 }, { order: 4 }, { order: 3 }] },
    })
    expect(orders).toEqual([1, 2, 4, 3])
  })

  it("legacy-снапшот без scenePrompts — null (работает фолбэк на позиции плана)", () => {
    expect(extractClipSceneOrders({ hook: "x" })).toBeNull()
    expect(extractClipSceneOrders(null)).toBeNull()
    expect(extractClipSceneOrders({ scenePrompts: { scenes: [] } })).toBeNull()
  })

  it("дырявый order обнуляет весь порядок — частичной карте доверять нельзя", () => {
    expect(extractClipSceneOrders({ scenePrompts: { scenes: [{ order: 1 }, { prompt: "нет order" }] } })).toBeNull()
  })
})

describe("buildPresenterDurationWindow", () => {
  const model = { minDurationSec: 2, maxDurationSec: 10, maxDeltaSec: 1 }

  it("окно сужается до ±maxDeltaSec вокруг плановой длины сцены", () => {
    const window = buildPresenterDurationWindow({ sceneDurationSec: 9, ...model })
    expect(window).toEqual({ minSec: 8, maxSec: 10, targetSec: 9, maxDeltaSec: 1 })
  })

  it("края режутся диапазоном модели", () => {
    const window = buildPresenterDurationWindow({ sceneDurationSec: 2.2, ...model })
    expect(window?.minSec).toBe(2)
    expect(window?.maxSec).toBeCloseTo(3.2, 5)
  })

  it("сцена вне досягаемости модели окна не получает", () => {
    // 30-секундную сцену не спасёт ни один клип 2-10 с: подстановка укоротила бы её.
    expect(buildPresenterDurationWindow({ sceneDurationSec: 30, ...model })).toBeNull()
    expect(buildPresenterDurationWindow({ sceneDurationSec: 0, ...model })).toBeNull()
  })
})
