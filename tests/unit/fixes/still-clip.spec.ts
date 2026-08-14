/**
 * Перебивка из неподвижного кадра.
 *
 * Картинка сцены превращается в клип нужной длины средствами ffmpeg: платного
 * вызова к провайдеру нет вовсе, кадр уже оплачен на шаге изображений.
 * Движение берётся из того же набора планов, что и смена плана внутри сцены.
 */

import { describe, expect, it } from "vitest"
import { buildStillClipArgs } from "../../../server/utils/video-tools/still-clip"

const BASE = {
  imagePath: "/assets/scene_2.png",
  outputPath: "/assets/scene_2_clip.mp4",
  durationSec: 9,
  sceneIndex: 2,
  format: "portrait" as const,
}

function argsOf(overrides: Partial<typeof BASE> = {}): string[] {
  return buildStillClipArgs({ ...BASE, ...overrides })
}

describe("buildStillClipArgs", () => {
  it("зацикливает кадр ровно на длительность сцены", () => {
    const args = argsOf()
    expect(args).toContain("-loop")
    const durationIndex = args.indexOf("-t")
    expect(durationIndex).toBeGreaterThan(-1)
    expect(args[durationIndex + 1]).toBe("9")
  })

  it("кадр приводится к формату ролика и получает движение", () => {
    const args = argsOf().join(" ")
    expect(args).toContain("1080:1920")
    expect(args).toContain("crop=1080:1920")
  })

  it("горизонтальный формат даёт свой размер кадра", () => {
    expect(argsOf({ format: "landscape" }).join(" ")).toContain("crop=1920:1080")
  })

  it("в клипе есть звуковая дорожка — иначе склейка теряет синхронизацию", () => {
    // Остальные клипы ролика идут со звуком; немой файл в concat сдвигает
    // таймлайн, и субтитры разъезжаются с картинкой.
    expect(argsOf().join(" ")).toContain("anullsrc")
  })

  it("соседние перебивки двигаются по-разному", () => {
    const first = argsOf({ sceneIndex: 1 }).join(" ")
    const second = argsOf({ sceneIndex: 2 }).join(" ")
    expect(first).not.toBe(second)
  })

  it("нулевая длительность не даёт клип нулевой длины", () => {
    const args = argsOf({ durationSec: 0 })
    const durationIndex = args.indexOf("-t")
    expect(Number(args[durationIndex + 1])).toBeGreaterThan(0)
  })

  it("выход всегда в конце команды — так его читает ffmpeg", () => {
    const args = argsOf()
    expect(args[args.length - 1]).toBe(BASE.outputPath)
  })
})
