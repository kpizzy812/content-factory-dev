import { describe, expect, it } from "vitest"

import { planShotAssembly } from "~~/server/utils/render"

const SHOTS = [
  { order: 0, startSec: 0, endSec: 1.8, path: "/a/shot_0.mp4" },
  { order: 1, startSec: 1.8, endSec: 3.6, path: "/a/shot_1.mp4" },
]

describe("решения кадровой сборки", () => {
  it("кадровый таймлайн задан — подгон длин под трек НЕ исполняется", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] })
    // Кадры по построению покрывают трек ровно: подгонять нечего, а лишний
    // проход тронул бы уже точные границы.
    expect(plan.usesClipTrackAlignment).toBe(false)
  })

  it("склейка идёт по кадрам в порядке order, а не по клипам сцен", () => {
    const plan = planShotAssembly({
      shotTimeline: { shots: [SHOTS[1]!, SHOTS[0]!], trackDurationSec: 3.6 },
      clipVolumeWithVoiceover: 0, clips: ["/a/scene_0.mp4"],
    })
    expect(plan.concatPaths).toEqual(["/a/shot_0.mp4", "/a/shot_1.mp4"])
  })

  it("дорожки картинки идут В НОЛЬ — иначе двойная речь с эхом (§6.4)", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] })
    expect(plan.clipLaneVolume).toBe(0)
  })

  it("субтитры на кадровом маршруте берутся из трека, а не из позиций клипов", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] })
    expect(plan.subtitleSource).toBe("shots")
  })

  it("кадрового таймлайна нет — поведение старого маршрута побайтово прежнее", () => {
    const plan = planShotAssembly({ clips: ["/a/scene_0.mp4", "/a/scene_1.mp4"], clipVolumeWithVoiceover: 0.3 })
    expect(plan.concatPaths).toEqual(["/a/scene_0.mp4", "/a/scene_1.mp4"])
    expect(plan.clipLaneVolume).toBe(0.3)
    expect(plan.subtitleSource).not.toBe("shots")
  })

  it("пустой кадровый таймлайн не превращается в пустую склейку молча", () => {
    expect(() => planShotAssembly({ shotTimeline: { shots: [], trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] }))
      .toThrow()
  })

  // Сверх брифа (Step 5 prose): shotTimeline и clipTrackAlignment — две разные
  // шкалы времени в одной сборке. Заданы одновременно — это ошибка
  // вызывающего, а не молчаливый приоритет одного над другим.
  it("shotTimeline и clipTrackAlignment заданы одновременно — ошибка вызывающего, бросает явно", () => {
    expect(() => planShotAssembly({
      shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 },
      clipTrackAlignment: { alignedScenes: [], positionByOrder: new Map(), trackDurationSec: 3.6 },
      clipVolumeWithVoiceover: 0,
      clips: [],
    })).toThrow()
  })

  it("субтитры вне кадрового маршрута классифицируются как clips/legacy по hasSceneSubtitles", () => {
    const withScenes = planShotAssembly({ clips: ["/a/scene_0.mp4"], clipVolumeWithVoiceover: 0.3, hasSceneSubtitles: true })
    const withoutScenes = planShotAssembly({ clips: ["/a/scene_0.mp4"], clipVolumeWithVoiceover: 0.3, hasSceneSubtitles: false })
    expect(withScenes.subtitleSource).toBe("clips")
    expect(withoutScenes.subtitleSource).toBe("legacy")
  })
})
