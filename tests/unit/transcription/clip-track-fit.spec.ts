/**
 * Фикс-раунд 1 (ревью Task 10): "Средняя" + "Средняя" находки — чистая часть
 * ffmpeg-обёрток подгона длины клипа (по образцу buildSegmentCutArgs/
 * buildStillClipArgs) и сама механика `fitClipsToTrack` покрыты тестом с
 * инъецированными зависимостями (по образцу `cutTrackSegment`), без реального
 * ffmpeg.
 */
import { describe, expect, it, vi } from "vitest"

import {
  buildClipHoldLastFrameArgs,
  buildClipTrimArgs,
  fitClipsToTrack,
} from "~~/server/utils/render"
import { TIMELINE_FPS } from "~~/shared/types/video-runtime"
import type { AlignedScene } from "~~/server/utils/transcription/align"

function scene(order: number, startSec: number): AlignedScene {
  return { order, startSec, endSec: startSec + 1, words: [] }
}

describe("buildClipTrimArgs — чистая сборка аргументов обрезки", () => {
  it("режет видео и аудио до цели, concat-safe профиль", () => {
    const args = buildClipTrimArgs(4.256, true)

    expect(args.filters[0]).toContain("trim=0:4.256")
    expect(args.filters[0]).toContain(`fps=${TIMELINE_FPS}`)
    expect(args.filters[1]).toContain("atrim=0:4.256")
    expect(args.outputOptions).toEqual(expect.arrayContaining([
      "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
      "-r", `${TIMELINE_FPS}`, "-video_track_timescale", "30000",
    ]))
  })

  it("без аудио — только видео-фильтр и без аудио-кодека на выходе", () => {
    const args = buildClipTrimArgs(4, false)

    expect(args.filters).toHaveLength(1)
    expect(args.outputOptions).not.toContain("-c:a")
  })

  it("клампит цель снизу до 0.04с — нулевая/отрицательная цель не уронит ffmpeg", () => {
    const args = buildClipTrimArgs(0.001, false)
    expect(args.filters[0]).toContain("trim=0:0.040")

    const negative = buildClipTrimArgs(-1, false)
    expect(negative.filters[0]).toContain("trim=0:0.040")
  })
})

describe("buildClipHoldLastFrameArgs — чистая сборка аргументов удержания кадра", () => {
  it("держит последний кадр tpad, звук добивает тишиной apad", () => {
    const args = buildClipHoldLastFrameArgs(1.5, true)

    expect(args.filters[0]).toContain("tpad=stop_mode=clone:stop_duration=1.500")
    expect(args.filters[0]).toContain(`fps=${TIMELINE_FPS}`)
    expect(args.filters[1]).toContain("apad=pad_dur=1.500")
  })

  it("без аудио — только видео-фильтр", () => {
    const args = buildClipHoldLastFrameArgs(1, false)
    expect(args.filters).toHaveLength(1)
    expect(args.outputOptions).not.toContain("-c:a")
  })

  it("клампит добавку снизу до 0.04с", () => {
    const args = buildClipHoldLastFrameArgs(0, false)
    expect(args.filters[0]).toContain("stop_duration=0.040")
  })
})

describe("fitClipsToTrack — подгон с инъецированными зависимостями (без ffmpeg)", () => {
  function makeDeps(durations: Record<string, number | null>) {
    return {
      probeDuration: vi.fn(async (path: string) => durations[path] ?? null),
      trim: vi.fn(async () => {}),
      holdLastFrame: vi.fn(async () => {}),
    }
  }

  it("подрезает длинный клип, удерживает короткий, не трогает уложившийся в допуск", async () => {
    const deps = makeDeps({ "c0.mp4": 4.5, "c1.mp4": 3.5, "c2.mp4": 4.02 })

    const result = await fitClipsToTrack(
      ["c0.mp4", "c1.mp4", "c2.mp4"],
      {
        alignedScenes: [scene(1, 0), scene(2, 4), scene(3, 8)],
        positionByOrder: new Map([[1, 0], [2, 1], [3, 2]]),
        trackDurationSec: 12,
      },
      deps,
    )

    expect(result.summary).toMatchObject({ applied: true, trimmedCount: 1, heldCount: 1 })
    expect(result.summary.totalDeltaSec).toBeCloseTo(1.0, 6) // |4.5-4| + |3.5-4|, clip2 в допуске не считается

    expect(deps.trim).toHaveBeenCalledWith("c0.mp4", "c0_fit.mp4", 4)
    expect(deps.holdLastFrame).toHaveBeenCalledWith("c1.mp4", "c1_fit.mp4", expect.closeTo(0.5, 6))
    expect(deps.trim).not.toHaveBeenCalledWith("c2.mp4", expect.anything(), expect.anything())
    expect(deps.holdLastFrame).not.toHaveBeenCalledWith("c2.mp4", expect.anything(), expect.anything())

    expect(result.clips).toEqual(["c0_fit.mp4", "c1_fit.mp4", "c2.mp4"])
  })

  it("путь без .mp4 получает суффикс, а не совпадает со входом", async () => {
    const deps = makeDeps({ c0: 4.5 })

    const result = await fitClipsToTrack(
      ["c0"],
      {
        alignedScenes: [scene(1, 0)],
        positionByOrder: new Map([[1, 0]]),
        trackDurationSec: 4,
      },
      deps,
    )

    expect(result.clips[0]).not.toBe("c0")
    expect(result.clips[0]).toBe("c0_fit.mp4")
  })

  it("нарушение порядка сцен отключает подгон целиком: файлы не трогаются", async () => {
    const deps = makeDeps({ "a.mp4": 4, "b.mp4": 3 })

    const result = await fitClipsToTrack(
      ["a.mp4", "b.mp4"],
      {
        // Сцена 2 звучит РАНЬШЕ сцены 1, но клип сцены 1 идёт первым в склейке.
        alignedScenes: [scene(1, 5), scene(2, 1)],
        positionByOrder: new Map([[1, 0], [2, 1]]),
        trackDurationSec: 10,
      },
      deps,
    )

    expect(result.summary.applied).toBe(false)
    expect(result.summary.reason).toMatch(/порядок/)
    expect(deps.trim).not.toHaveBeenCalled()
    expect(deps.holdLastFrame).not.toHaveBeenCalled()
    expect(result.clips).toEqual(["a.mp4", "b.mp4"])
  })

  it("неизмеримый клип отключает подгон целиком, а не только для себя", async () => {
    const deps = makeDeps({ "a.mp4": 4 }) // b.mp4 не измерен → probeDuration вернёт null

    const result = await fitClipsToTrack(
      ["a.mp4", "b.mp4"],
      {
        alignedScenes: [scene(1, 0), scene(2, 4)],
        positionByOrder: new Map([[1, 0], [2, 1]]),
        trackDurationSec: 8,
      },
      deps,
    )

    expect(result.summary.applied).toBe(false)
    expect(result.summary.reason).toMatch(/не измерен/)
    expect(deps.trim).not.toHaveBeenCalled()
    expect(deps.holdLastFrame).not.toHaveBeenCalled()
  })

  it("карта позиций пуста (нет clipSceneOrders) — честный отказ, а не тихий no-op", async () => {
    const deps = makeDeps({ "a.mp4": 4 })

    const result = await fitClipsToTrack(
      ["a.mp4"],
      {
        alignedScenes: [scene(1, 0)],
        positionByOrder: new Map(), // пусто
        trackDurationSec: 4,
      },
      deps,
    )

    expect(result.summary.applied).toBe(false)
    expect(result.summary.reason).toMatch(/не сопоставилась/)
  })
})
