import { describe, expect, it } from "vitest"

import { planSegmentCut, segmentIdentity } from "~~/server/utils/voiceover/segment-cut"

const MODEL = { minDurationSec: 2, maxDurationSec: 10 }

describe("вырезка куска трека под сцену", () => {
  it("режет по границам сцены, притянутым к кадру", () => {
    const cut = planSegmentCut({
      scene: { order: 1, startSec: 1.237, endSec: 4.611, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    // 30 fps: кадр длится 1/30 с, границы обязаны попадать в его начало.
    expect(Math.round(cut.startSec * 30) / 30).toBeCloseTo(cut.startSec, 6)
    expect(Math.round(cut.endSec * 30) / 30).toBeCloseTo(cut.endSec, 6)
    expect(cut.durationSec).toBeCloseTo(cut.endSec - cut.startSec, 6)
  })

  it("не вылезает за пределы трека", () => {
    const cut = planSegmentCut({
      scene: { order: 9, startSec: 58.5, endSec: 62.0, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    expect(cut.endSec).toBeLessThanOrEqual(60)
  })

  it("зажимает кусок в границы модели и говорит об этом", () => {
    const cut = planSegmentCut({
      scene: { order: 2, startSec: 0, endSec: 14, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    expect(cut.durationSec).toBeLessThanOrEqual(10)
    expect(cut.clampedToModel).toBe(true)
  })

  it("ключ идентичности зависит от интервала и от самого трека, а не от текста", () => {
    const base = { videoId: 7, sceneOrder: 1, startSec: 1, endSec: 4, trackFingerprint: "abc" }

    expect(segmentIdentity(base)).toBe(segmentIdentity({ ...base }))
    expect(segmentIdentity(base)).not.toBe(segmentIdentity({ ...base, startSec: 1.5 }))
    // Новый трек обесценивает все куски: иначе к свежему звуку подставятся
    // старые губы (spec §4.4).
    expect(segmentIdentity(base)).not.toBe(segmentIdentity({ ...base, trackFingerprint: "def" }))
  })
})
