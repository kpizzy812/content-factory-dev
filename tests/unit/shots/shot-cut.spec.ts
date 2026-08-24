import { describe, expect, it } from "vitest"

import { buildShotSubClipArgs } from "~~/server/utils/video-tools/shot-cut"
import { TIMELINE_FPS } from "~~/shared/types/video-runtime"

const BASE = { sourcePath: "/a/scene_1_lipsync.mp4", outputPath: "/a/shot_5.mp4", audioPresent: true }

function argsFor(startSec: number, durationSec: number) {
  return buildShotSubClipArgs({ ...BASE, startSec, durationSec })
}

describe("вырезка подотрезка кадра из готового клипа", () => {
  it("-ss стоит ПЕРЕД -i: иначе ffmpeg декодирует весь клип до точки реза", () => {
    const args = argsFor(2.0, 1.8)
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"))
  })

  it("режет ровно заказанные секунды", () => {
    const args = argsFor(2.0, 1.8)
    expect(args[args.indexOf("-ss") + 1]).toBe("2.000")
    expect(args[args.indexOf("-t") + 1]).toBe("1.800")
  })

  it("частота нормализации — та же, что у всей склейки", () => {
    expect(argsFor(0, 1.8).join(" ")).toContain(`fps=${TIMELINE_FPS}`)
  })

  it("немой источник получает синтетическую дорожку — concat не терпит разнородных потоков", () => {
    const silent = buildShotSubClipArgs({ ...BASE, startSec: 0, durationSec: 1.8, audioPresent: false })
    expect(silent.join(" ")).toContain("anullsrc")
    const voiced = argsFor(0, 1.8)
    expect(voiced.join(" ")).not.toContain("anullsrc")
  })

  it("отрицательный старт и неположительная длина зажимаются, а не уезжают в ffmpeg", () => {
    const args = buildShotSubClipArgs({ ...BASE, startSec: -3, durationSec: 0, audioPresent: true })
    expect(args[args.indexOf("-ss") + 1]).toBe("0.000")
    expect(Number(args[args.indexOf("-t") + 1])).toBeGreaterThan(0)
  })

  it("NaN и Infinity не доезжают до аргументов", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const args = buildShotSubClipArgs({ ...BASE, startSec: bad, durationSec: bad, audioPresent: true })
      expect(args.every(a => !a.includes("NaN") && !a.includes("Infinity"))).toBe(true)
    }
  })

  it("выход пишется в заказанный путь последним аргументом", () => {
    expect(argsFor(1, 1).at(-1)).toBe(BASE.outputPath)
  })
})
