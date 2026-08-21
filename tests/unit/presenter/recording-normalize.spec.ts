import { describe, expect, it } from "vitest"

import { buildRecordingNormalizeArgs } from "~~/server/utils/presenter/recording-normalize"

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

describe("аргументы нормализации записи ведущего", () => {
  it("ограничивает большую сторону 1920 и НЕ кропает в 9:16", () => {
    const args = buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4")
    const vf = valueAfter(args, "-vf")!

    // decrease вписывает кадр в рамку, не растягивая и не обрезая: кроп при
    // загрузке убил бы крупный план, средний план и PiP из одного материала.
    expect(vf).toContain("force_original_aspect_ratio=decrease")
    expect(vf).toContain("1920")
    expect(vf).not.toContain("crop")
    expect(vf).not.toContain("pad=")
  })

  it("выравнивает стороны до чётных — yuv420p нечётные не кодирует", () => {
    const vf = valueAfter(buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4"), "-vf")!

    expect(vf).toContain("trunc(iw/2)*2")
    expect(vf).toContain("trunc(ih/2)*2")
  })

  it("приводит к H.264 30 fps и AAC", () => {
    const args = buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4")

    expect(valueAfter(args, "-c:v")).toBe("libx264")
    expect(valueAfter(args, "-r")).toBe("30")
    expect(valueAfter(args, "-c:a")).toBe("aac")
    expect(args).toContain("-movflags")
  })

  it("ставит вход и выход в правильном порядке", () => {
    const args = buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4")

    expect(valueAfter(args, "-i")).toBe("/tmp/in.mov")
    expect(args[args.length - 1]).toBe("/tmp/out.mp4")
  })

  it("принимает свои пределы — 4K-материал можно нормализовать иначе", () => {
    const vf = valueAfter(
      buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4", { maxSide: 1280, fps: 25 }),
      "-vf",
    )!

    expect(vf).toContain("1280")
    expect(valueAfter(buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4", { fps: 25 }), "-r")).toBe("25")
  })
})
