import { describe, expect, it } from "vitest"

import { buildPauseInsertionPlan, planPauseSplit } from "~~/server/utils/voiceover/insert-pauses"

const scene = (order: number, text: string) => ({ order, text })

describe("расчёт точек разреза паузы (planPauseSplit)", () => {
  it("точка разреза — по доле символов сцены от всего текста", () => {
    const plan = planPauseSplit(
      [{ afterSceneOrder: 1, durationSec: 2 }],
      [scene(1, "12345"), scene(2, "12345")],
      10,
    )

    // Сцена 1 — ровно половина символов трека (5 из 10) → половина времени.
    expect(plan.points).toEqual([{ afterSceneOrder: 1, atSec: 5, durationSec: 2 }])
    expect(plan.skipped).toEqual([])
  })

  it("пауза без опорной сцены уходит в skipped, а не теряется молча", () => {
    // buildTrackRequest кладёт паузу в список ДО фильтра пустого текста —
    // сцена, целиком состоящая из маркера паузы, в `scenes` не попадает.
    const plan = planPauseSplit(
      [{ afterSceneOrder: 9, durationSec: 1.5 }],
      [scene(1, "abc")],
      10,
    )

    expect(plan.points).toEqual([])
    expect(plan.skipped).toEqual([{ afterSceneOrder: 9, durationSec: 1.5 }])
  })

  it("точки сортируются по времени, а не по порядку пауз на входе", () => {
    const plan = planPauseSplit(
      [{ afterSceneOrder: 2, durationSec: 1 }, { afterSceneOrder: 1, durationSec: 1 }],
      [scene(1, "12345"), scene(2, "12345"), scene(3, "12345")],
      15,
    )

    expect(plan.points.map(p => p.afterSceneOrder)).toEqual([1, 2])
  })

  it("сцены без текста — точек нет, все паузы пропущены", () => {
    const plan = planPauseSplit(
      [{ afterSceneOrder: 1, durationSec: 2 }],
      [scene(1, "")],
      10,
    )

    expect(plan.points).toEqual([])
    expect(plan.skipped).toEqual([{ afterSceneOrder: 1, durationSec: 2 }])
  })
})

describe("сборка ffmpeg-плана вставки тишины (buildPauseInsertionPlan)", () => {
  it("разрезает исходник и вставляет anullsrc нужной длины между кусками", () => {
    const plan = buildPauseInsertionPlan(
      "/tmp/track.mp3",
      [{ afterSceneOrder: 1, atSec: 5, durationSec: 2 }],
      10,
    )

    const joined = plan.filters.join("\n")
    expect(joined).toContain("atrim=0.000:5.000")
    expect(joined).toContain("atrim=5.000:10.000")
    expect(joined).toContain("anullsrc=channel_layout=stereo:sample_rate=44100")
    expect(joined).toContain("atrim=0:2.000")
    expect(plan.filters[plan.filters.length - 1]).toContain("concat=n=3:v=0:a=1")
  })

  it("без точек разреза — один кусок на весь трек, тишины нет", () => {
    const plan = buildPauseInsertionPlan("/tmp/track.mp3", [], 10)

    expect(plan.filters.some(f => f.includes("anullsrc"))).toBe(false)
    expect(plan.filters[plan.filters.length - 1]).toContain("concat=n=1:v=0:a=1")
  })

  it("выходной файл получает суффикс _paused, расширение сохраняется", () => {
    const plan = buildPauseInsertionPlan("/tmp/assets/voiceover_track.mp3", [], 10)

    expect(plan.outputPath).toBe("/tmp/assets/voiceover_track_paused.mp3")
  })

  it("несколько точек разреза дают несколько кусков тишины по порядку", () => {
    const plan = buildPauseInsertionPlan(
      "/tmp/track.mp3",
      [
        { afterSceneOrder: 1, atSec: 3, durationSec: 1 },
        { afterSceneOrder: 2, atSec: 7, durationSec: 2.5 },
      ],
      10,
    )

    const silenceCount = plan.filters.filter(f => f.includes("anullsrc")).length
    expect(silenceCount).toBe(2)
    expect(plan.filters[plan.filters.length - 1]).toContain("concat=n=5:v=0:a=1")
  })
})
