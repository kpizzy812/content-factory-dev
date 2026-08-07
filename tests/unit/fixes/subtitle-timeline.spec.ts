/**
 * Регрессии таймлайна субтитров.
 *
 * Дефект: окна показа считались по позиции субтитра в ОТФИЛЬТРОВАННОМ массиве.
 * Сцена с пустым subtitleCopy выпадала из массива, и весь хвост субтитров уезжал
 * на одну сцену вперёд — текст показывался поверх чужого клипа. Плюс в ASS-ветке
 * при одном клипе первый субтитр забирал себе всю длительность ролика.
 *
 * Тесты идут двумя слоями: чистая арифметика scene-timeline.ts и реальный проход
 * через assembleVideo (ffmpeg/ASS-рендер замоканы) — чтобы проверить, что render
 * действительно пользуется новыми окнами, а не только что функция существует.
 */
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SubtitlePlacement } from "~~/shared/types/story"
import {
  buildSceneClipTimeline,
  buildSubtitleTimeline,
  type SceneSubtitleInput,
} from "../../../server/utils/subtitles/scene-timeline"

const BOTTOM: SubtitlePlacement = { position: "bottom", alignment: "center", avoidZones: [] }

function sub(sceneIndex: number, text: string, durationSec = 5): SceneSubtitleInput {
  return { sceneIndex, text, placement: BOTTOM, durationSec }
}

// ── Слой 1: чистая арифметика окон ──────────────────────────────────────────

describe("buildSubtitleTimeline: окна по реальным клипам", () => {
  it("сцена без текста не сдвигает окна следующих субтитров", () => {
    // Клипы 4 + 3 + 5 + 2. Текст есть у сцен 0, 2 и 3 — сцена 1 молчит.
    const windows = buildSubtitleTimeline(
      [4, 3, 5, 2],
      [sub(0, "Первая"), sub(2, "Третья"), sub(3, "Четвёртая")],
    )

    expect(windows.map(w => w.sceneIndex)).toEqual([0, 2, 3])
    // Старт сцены 2 = 4 + 3 = 7. Старое поведение брало второй клип и давало 4.
    expect(windows[1]!.startSec).toBe(7)
    expect(windows[1]!.endSec).toBeCloseTo(11.9, 5)
    // Старт сцены 3 = 4 + 3 + 5 = 12, а не 7.
    expect(windows[2]!.startSec).toBe(12)
    expect(windows[2]!.endSec).toBeCloseTo(13.9, 5)
  })

  it("пустой текст сцены просто выпадает и не занимает окно", () => {
    const windows = buildSubtitleTimeline(
      [4, 3, 5],
      [sub(0, "Первая"), sub(1, "   "), sub(2, "Третья")],
    )

    expect(windows).toHaveLength(2)
    expect(windows.map(w => w.startSec)).toEqual([0, 7])
  })

  it("длительности берутся у клипов, а плановый durationSec игнорируется", () => {
    // В плане у сцен по 99 секунд, реальные клипы — 4 и 3.
    const windows = buildSubtitleTimeline(
      [4, 3],
      [sub(0, "Первая", 99), sub(1, "Вторая", 99)],
    )

    expect(windows[0]!.endSec).toBeCloseTo(3.9, 5)
    expect(windows[1]!.startSec).toBe(4)
    expect(windows[1]!.endSec).toBeCloseTo(6.9, 5)
  })

  it("субтитр сцены, для которой клип не сгенерирован, отбрасывается", () => {
    // Частичная генерация: клипов 2, а текст есть и у третьей сцены.
    const windows = buildSubtitleTimeline(
      [4, 3],
      [sub(0, "Первая"), sub(2, "Третья")],
    )

    expect(windows.map(w => w.sceneIndex)).toEqual([0])
  })

  it("зазор в конце окна настраивается и не даёт отрицательной длины", () => {
    const windows = buildSubtitleTimeline([0.05, 3], [sub(0, "Короткая")], { gapSec: 0.5 })

    expect(windows[0]!.endSec).toBeGreaterThanOrEqual(windows[0]!.startSec)
  })

  it("один клип: субтитры раскладываются последовательно, а не отдают первому весь ролик", () => {
    // Три реплики по 3с смонтированы в один десятисекундный клип.
    const windows = buildSubtitleTimeline([10], [sub(0, "Раз", 3), sub(1, "Два", 3), sub(2, "Три", 3)])

    expect(windows).toHaveLength(3)
    expect(windows.map(w => w.startSec)).toEqual([0, 3, 6])
    expect(windows[0]!.endSec).toBeCloseTo(2.9, 5)
    expect(windows[2]!.endSec).toBeCloseTo(8.9, 5)
    // Окна не наезжают друг на друга.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.startSec).toBeGreaterThanOrEqual(windows[i - 1]!.endSec)
    }
  })

  it("один клип: хвост обрезается по концу клипа, а не выезжает за ролик", () => {
    const windows = buildSubtitleTimeline([5], [sub(0, "Раз", 4), sub(1, "Два", 4), sub(2, "Три", 4)])

    // Третий субтитр начинается за пределами клипа — его вообще нет.
    expect(windows).toHaveLength(2)
    expect(windows[1]!.endSec).toBeLessThanOrEqual(5)
  })

  it("без клипов раскладка идёт по плановым длительностям", () => {
    const windows = buildSubtitleTimeline([], [sub(0, "Раз", 3), sub(1, "Два", 2)])

    expect(windows.map(w => w.startSec)).toEqual([0, 3])
  })

  it("пустой список текстов даёт пустой таймлайн", () => {
    expect(buildSubtitleTimeline([4, 3], [sub(0, ""), sub(1, "  ")])).toEqual([])
  })
})

describe("buildSceneClipTimeline: сцены и клипы 1:1", () => {
  it("старты сцен — префиксные суммы реальных клипов", () => {
    expect(buildSceneClipTimeline([4, 3, 5], 3)).toEqual([
      { sceneIndex: 0, startSec: 0, clipDurationSec: 4 },
      { sceneIndex: 1, startSec: 4, clipDurationSec: 3 },
      { sceneIndex: 2, startSec: 7, clipDurationSec: 5 },
    ])
  })

  it("отсутствующий клип виден явно и не двигает таймлайн плановой длительностью", () => {
    // Клипов 2 на 4 сцены — хвост не должен молча получать плановые секунды.
    const slots = buildSceneClipTimeline([4, 3], 4)

    expect(slots[2]).toEqual({ sceneIndex: 2, startSec: 7, clipDurationSec: null })
    expect(slots[3]).toEqual({ sceneIndex: 3, startSec: 7, clipDurationSec: null })
  })

  it("лишние клипы сверх числа сцен не создают слотов", () => {
    expect(buildSceneClipTimeline([4, 3, 5], 2)).toHaveLength(2)
  })
})

// ── Слой 2: реальный проход через assembleVideo ─────────────────────────────

/** Состояние фейкового ffmpeg — общее для hoisted-моков и тестов. */
const ff = vi.hoisted(() => ({
  /** Длительность клипа ищется по подстроке в пути (clip_0 → 4с и т.п.). */
  durationByToken: {} as Record<string, number>,
  /** Аргументы всех вызовов command.videoFilters() — там живут drawtext-фильтры. */
  videoFilterCalls: [] as string[][],
  /** Сегменты, с которыми вызвали ASS-рендерер. */
  assSegments: [] as Array<Array<Record<string, unknown>>>,
}))

vi.mock("fluent-ffmpeg", () => {
  const durationFor = (path: string): number => {
    for (const [token, dur] of Object.entries(ff.durationByToken)) {
      if (path.includes(token)) return dur
    }
    return 5
  }

  const makeCommand = () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const cmd: Record<string, unknown> = {}
    const chain = () => cmd
    Object.assign(cmd, {
      input: chain,
      inputOptions: chain,
      complexFilter: chain,
      audioFilters: chain,
      outputOptions: chain,
      output: chain,
      videoFilters: (filters: string[]) => {
        ff.videoFilterCalls.push(filters)
        return cmd
      },
      on: (event: string, cb: (...args: unknown[]) => void) => {
        handlers.set(event, cb)
        return cmd
      },
      // Успешный прогон: сразу отдаём 'end', никакого настоящего кодирования.
      run: () => { setTimeout(() => handlers.get("end")?.(), 0) },
    })
    return cmd
  }

  const ffmpeg = Object.assign(() => makeCommand(), {
    ffprobe: (path: string, cb: (err: unknown, meta: unknown) => void) => {
      setTimeout(() => cb(null, { format: { duration: durationFor(path) }, streams: [] }), 0)
    },
  })
  return { default: ffmpeg }
})

vi.mock("../../../server/utils/subtitles/render-ass", () => ({
  tryRenderAssFilter: vi.fn(async (opts: { segments: Array<Record<string, unknown>> }) => {
    ff.assSegments.push(opts.segments)
    // null — штатный фолбэк на drawtext, ролик всё равно собирается.
    return null
  }),
}))

let workDir = ""

async function ensureWorkDir(): Promise<string> {
  if (!workDir) workDir = await mkdtemp(join(tmpdir(), "cf-subs-"))
  return workDir
}

/** Достаёт окна `enable='between(t,a,b)'` из собранных drawtext-фильтров. */
function enableWindows(): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const call of ff.videoFilterCalls) {
    for (const filter of call) {
      const m = filter.match(/enable='between\(t,([\d.]+),([\d.]+)\)'/)
      if (m) out.push([Number(m[1]), Number(m[2])])
    }
  }
  return out
}

describe("assembleVideo: субтитры ложатся на клип своей сцены", () => {
  beforeEach(() => {
    ff.videoFilterCalls.length = 0
    ff.assSegments.length = 0
    ff.durationByToken = { clip_0: 4, clip_1: 3, clip_2: 5 }
  })

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true })
  })

  it("drawtext: пропущенная сцена не сдвигает окна хвоста", async () => {
    const dir = await ensureWorkDir()
    const { assembleVideo } = await import("../../../server/utils/render")

    await assembleVideo({
      clips: [join(dir, "clip_0.mp4"), join(dir, "clip_1.mp4"), join(dir, "clip_2.mp4")],
      topText: "",
      bottomText: "",
      musicPath: null,
      format: "portrait",
      outputPath: join(dir, "10.mp4"),
      // durationSec из плана намеренно врёт — окна обязаны считаться по клипам.
      sceneSubtitles: [sub(0, "Первая", 99), sub(2, "Третья", 99)],
      subtitlePreset: "classic",
    })

    // Сцена 2 идёт с 7-й секунды (4+3), а не с 4-й, как было при раскладке по позиции.
    expect(enableWindows()).toEqual([[0, 3.9], [7, 11.9]])
  })

  it("drawtext: один клип и несколько субтитров — последовательные окна", async () => {
    const dir = await ensureWorkDir()
    ff.durationByToken = { clip_0: 10 }
    const { assembleVideo } = await import("../../../server/utils/render")

    await assembleVideo({
      clips: [join(dir, "clip_0.mp4")],
      topText: "",
      bottomText: "",
      musicPath: null,
      format: "portrait",
      outputPath: join(dir, "11.mp4"),
      sceneSubtitles: [sub(0, "Раз", 3), sub(1, "Два", 3), sub(2, "Три", 3)],
      subtitlePreset: "classic",
    })

    // Раньше single-clip ветка показывала ОДИН самый длинный субтитр без окна.
    expect(enableWindows()).toEqual([[0, 2.9], [3, 5.9], [6, 8.9]])
  })

  it("ass: keywordHints достаются сегменту со своим текстом, а не соседнему", async () => {
    const dir = await ensureWorkDir()
    const { assembleVideo } = await import("../../../server/utils/render")

    await assembleVideo({
      clips: [join(dir, "clip_0.mp4"), join(dir, "clip_1.mp4"), join(dir, "clip_2.mp4")],
      topText: "",
      bottomText: "",
      musicPath: null,
      format: "portrait",
      outputPath: join(dir, "12.mp4"),
      // Сцена 1 без текста — подсказки нумеруются по сценам (order = sceneIndex + 1).
      sceneSubtitles: [sub(0, "Первая"), sub(2, "Третья")],
      subtitlePreset: "hormozi",
      keywordHints: [
        { order: 1, keywords: [{ word: "Первая", weight: 1 }] },
        { order: 3, keywords: [{ word: "Третья", weight: 1 }] },
      ],
    })

    const segments = ff.assSegments[0]!
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ text: "Первая", startSec: 0 })
    expect(segments[0]!.aiKeywords).toEqual([{ word: "Первая", weight: 1 }])
    // Ключ подсказки для второго сегмента — 3 (сцена 2), а не 2 (позиция в массиве):
    // на старом коде тут был undefined, и слово теряло подсветку.
    expect(segments[1]).toMatchObject({ text: "Третья", startSec: 7 })
    expect(segments[1]!.aiKeywords).toEqual([{ word: "Третья", weight: 1 }])
    expect(segments[1]!.endSec).toBeCloseTo(11.9, 5)
  })

  it("ass: legacy topText/bottomText растягиваются на весь ролик", async () => {
    const dir = await ensureWorkDir()
    const { assembleVideo } = await import("../../../server/utils/render")

    await assembleVideo({
      clips: [join(dir, "clip_0.mp4"), join(dir, "clip_1.mp4")],
      topText: "Хук",
      bottomText: "CTA",
      musicPath: null,
      format: "portrait",
      outputPath: join(dir, "13.mp4"),
      subtitlePreset: "hormozi",
    })

    const segments = ff.assSegments[0]!
    expect(segments.map(s => s.text)).toEqual(["Хук", "CTA"])
    expect(segments.every(s => s.startSec === 0 && s.endSec === 7)).toBe(true)
  })
})
