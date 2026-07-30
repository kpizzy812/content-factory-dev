import { describe, expect, it, vi } from "vitest"

import { ingestPresenterRecording } from "~~/server/utils/presenter/ingest-runner"
import { DHASH_HEIGHT, DHASH_WIDTH } from "~~/server/utils/presenter/perceptual-hash"

/**
 * Кадр из детерминированного LCG: разные seed дают структурно разные картинки,
 * а не одну и ту же со сдвигом яркости — dHash к такому сдвигу нечувствителен.
 */
function grayFrame(seed: number): Uint8Array {
  const pixels = new Uint8Array(DHASH_WIDTH * DHASH_HEIGHT)
  let state = (seed * 7919 + 13) % 2147483647 || 1
  for (let i = 0; i < pixels.length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648
    pixels[i] = state % 256
  }
  return pixels
}

function deps(overrides: Partial<Parameters<typeof ingestPresenterRecording>[1]> = {}) {
  let seed = 0
  return {
    probeDuration: vi.fn(async () => 20),
    detectScenes: vi.fn(async () => [10]),
    cutSegment: vi.fn(async () => {}),
    grayscaleThumbnail: vi.fn(async () => grayFrame((seed += 1))),
    ...overrides,
  }
}

const input = {
  recordingPath: "/tmp/long-take.mp4",
  outputDir: "/tmp/out",
}

describe("presenter ingest runner", () => {
  it("режет запись по сценам и отдаёт готовые клипы", async () => {
    const d = deps()
    const result = await ingestPresenterRecording(input, d)

    expect(result.clips).toHaveLength(2)
    expect(result.clips.map(c => [c.startSec, c.durationSec])).toEqual([[0, 10], [10, 10]])
    expect(d.cutSegment).toHaveBeenCalledTimes(2)
    expect(result.clips[0]!.filePath).toBe("/tmp/out/clip-001.mp4")
    expect(result.clips[1]!.filePath).toBe("/tmp/out/clip-002.mp4")
    expect(result.clips[0]!.perceptualHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it("выбрасывает клип, похожий на уже принятый в этом же прогоне", async () => {
    const d = deps({ grayscaleThumbnail: vi.fn(async () => grayFrame(42)) })
    const result = await ingestPresenterRecording(input, d)

    expect(result.clips).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe("duplicate")
  })

  it("выбрасывает клип, похожий на уже лежащий в библиотеке", async () => {
    const d = deps({ grayscaleThumbnail: vi.fn(async () => grayFrame(7)) })
    const known = await ingestPresenterRecording(input, deps({
      grayscaleThumbnail: vi.fn(async () => grayFrame(7)),
    }))
    const existingHash = known.clips[0]!.perceptualHash

    const result = await ingestPresenterRecording(
      { ...input, existingHashes: [existingHash] },
      d,
    )
    expect(result.clips).toHaveLength(0)
    expect(result.skipped).toHaveLength(2)
  })

  it("не режет запись, из которой нечего взять", async () => {
    const d = deps({ probeDuration: vi.fn(async () => 1.2) })
    const result = await ingestPresenterRecording(input, d)

    expect(result.clips).toEqual([])
    expect(d.cutSegment).not.toHaveBeenCalled()
    expect(result.durationSec).toBe(1.2)
  })

  it("переживает падение scene detection и режет равномерно", async () => {
    const d = deps({ detectScenes: vi.fn(async () => { throw new Error("ffmpeg умер") }) })
    const result = await ingestPresenterRecording(input, d)

    expect(result.clips).toHaveLength(2)
    expect(result.sceneDetectionFailed).toBe(true)
  })

  it("не роняет весь прогон из-за одного битого сегмента", async () => {
    const d = deps({
      cutSegment: vi.fn(async (_src: string, _start: number, _dur: number, out: string) => {
        if (out.endsWith("clip-001.mp4")) throw new Error("broken segment")
      }),
    })
    const result = await ingestPresenterRecording(input, d)

    expect(result.clips).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe("error")
    expect(result.skipped[0]!.message).toContain("broken segment")
  })

  it("уважает лимит на количество клипов из одной записи", async () => {
    const d = deps({ probeDuration: vi.fn(async () => 100), detectScenes: vi.fn(async () => []) })
    const result = await ingestPresenterRecording({ ...input, maxClips: 3 }, d)

    expect(result.clips).toHaveLength(3)
    expect(d.cutSegment).toHaveBeenCalledTimes(3)
  })
})
