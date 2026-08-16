import { describe, expect, it } from "vitest"

import {
  clipVolumeWithVoiceoverFor,
  computeAlignedClipTargetsSec,
  planDurationFit,
  shouldReconcileVoiceover,
} from "~~/server/utils/video-pipeline-run-policy"
import type { AlignedScene } from "~~/server/utils/transcription/align"

describe("подгон длины кадра под звук", () => {
  it("расхождение в пределах допуска не трогает ничего", () => {
    expect(planDurationFit({ expectedSec: 4, actualSec: 4.02 })).toMatchObject({ action: "none" })
  })

  it("клип длиннее заказанного подрезается", () => {
    const fit = planDurationFit({ expectedSec: 4, actualSec: 4.6 })

    expect(fit.action).toBe("trim")
    expect(fit.deltaSec).toBeCloseTo(0.6, 6)
  })

  it("клип короче заказанного удерживает последний кадр", () => {
    // Звук трогать нельзя: он эталон таймлайна (spec §8).
    expect(planDurationFit({ expectedSec: 4, actualSec: 3.5 })).toMatchObject({
      action: "hold_last_frame",
    })
  })

  it("расхождение больше секунды — это сбой, а не подгон", () => {
    expect(planDurationFit({ expectedSec: 4, actualSec: 1.2 })).toMatchObject({ action: "fail" })
  })
})

describe("решения сборки по маршруту", () => {
  it("на audio-first дорожки клипов глушатся полностью", () => {
    // Единый трек не совпадает по фазе с речью внутри lip-sync клипа: 0.3 дали
    // бы двойную речь с эхом (spec §6.4).
    expect(clipVolumeWithVoiceoverFor(true)).toBe(0)
  })

  it("на старом маршруте прежние 0.3 сохраняются", () => {
    expect(clipVolumeWithVoiceoverFor(false)).toBeCloseTo(0.3, 6)
  })

  it("на audio-first сведение длины отключено", () => {
    expect(shouldReconcileVoiceover(true)).toBe(false)
  })

  it("на старом маршруте сведение работает как прежде", () => {
    expect(shouldReconcileVoiceover(false)).toBe(true)
  })
})

// computeAlignedClipTargetsSec — расширение сверх брифа (см. progress.md, Task 9
// «вход для Task 10»): перебивки между кусками ведущего вставали в таймлайн с
// ПЛАНОВЫМИ длительностями, и звук уезжал от картинки к концу ролика. Функция
// строит заказанную длину КАЖДОГО клипа так, чтобы их сумма сходилась с длиной
// трека целиком, а не только чинила один клип.
function scene(order: number, startSec: number, endSec: number): AlignedScene {
  return { order, startSec, endSec, words: [] }
}

describe("ожидаемая длина клипов по выравниванию (computeAlignedClipTargetsSec)", () => {
  it("сумма заказанных длин сходится с длиной трека целиком", () => {
    const targets = computeAlignedClipTargetsSec({
      alignedScenes: [scene(1, 0.2, 4.6), scene(2, 5.0, 8.5), scene(3, 9.0, 11.9)],
      trackDurationSec: 12.4,
      positionByOrder: new Map([[1, 0], [2, 1], [3, 2]]),
      clipCount: 3,
    })

    expect(targets[0]).toBeCloseTo(5.0, 6)
    expect(targets[1]).toBeCloseTo(4.0, 6)
    expect(targets[2]).toBeCloseTo(3.4, 6)
    expect(targets.reduce((a, b) => a! + b!, 0)).toBeCloseTo(12.4, 6)
  })

  it("не зависит от порядка сцен во входном массиве", () => {
    const scenes = [scene(3, 9.0, 11.9), scene(1, 0.2, 4.6), scene(2, 5.0, 8.5)]
    const targets = computeAlignedClipTargetsSec({
      alignedScenes: scenes,
      trackDurationSec: 12.4,
      positionByOrder: new Map([[1, 0], [2, 1], [3, 2]]),
      clipCount: 3,
    })

    expect(targets[0]).toBeCloseTo(5.0, 6)
    expect(targets[1]).toBeCloseTo(4.0, 6)
    expect(targets[2]).toBeCloseTo(3.4, 6)
  })

  it("клип без своей сцены в выравнивании остаётся без заказанной длины", () => {
    // Сцена 2 не звучит вовсе (ни реплики в кадре, ни закадровой строки) —
    // подгонять её клип не к чему, но соседи всё равно закрывают трек целиком.
    const targets = computeAlignedClipTargetsSec({
      alignedScenes: [scene(1, 0.2, 4.6), scene(3, 9.0, 11.9)],
      trackDurationSec: 12.4,
      positionByOrder: new Map([[1, 0], [3, 2]]),
      clipCount: 3,
    })

    expect(targets[1]).toBeNull()
    expect(targets[0]).toBeCloseTo(9.0, 6)
    expect(targets[2]).toBeCloseTo(3.4, 6)
  })

  it("без выравнивания или без длины трека возвращает пустой результат", () => {
    expect(computeAlignedClipTargetsSec({
      alignedScenes: [],
      trackDurationSec: 12.4,
      positionByOrder: new Map(),
      clipCount: 2,
    })).toEqual([null, null])

    expect(computeAlignedClipTargetsSec({
      alignedScenes: [scene(1, 0, 4)],
      trackDurationSec: 0,
      positionByOrder: new Map([[1, 0]]),
      clipCount: 1,
    })).toEqual([null])
  })
})
