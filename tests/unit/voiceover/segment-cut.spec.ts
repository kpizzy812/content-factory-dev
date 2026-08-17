/**
 * Вырезка куска общего трека под сцену.
 *
 * Тесты из брифа усилены после ревью: проверяются ЗНАЧЕНИЯ границ, а не только
 * их кратность кадру, добивка короткого куска тишиной (раздвигать интервал по
 * треку нельзя — в кусок уехала бы чужая реплика) и чувствительность ключа к
 * каждому своему полю. Аргументы ffmpeg проверяются без запуска процесса.
 */

import { existsSync, readFileSync } from "node:fs"
import { mkdir, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildSegmentCutArgs,
  cutTrackSegment,
  planSegmentCut,
  segmentIdentity,
  type SegmentCut,
} from "~~/server/utils/voiceover/segment-cut"

/**
 * `cutTrackSegment` запускает ffmpeg (fluent-ffmpeg) — по образцу
 * `insert-pauses.spec.ts` реальный процесс в юнит-тестах не запускаем. В
 * отличие от того образца, мок реально пишет байты на диск (в скретч-
 * директорию в os.tmpdir()): temp+rename и подчистку временного файла нечем
 * проверить, если мок не трогает файловую систему.
 *
 * Провал ffmpeg дополнительно пишет ЧАСТИЧНЫЕ байты по пути из `.output()`
 * ДО вызова `error` — ровно так ведёт себя настоящий ffmpeg при обрыве
 * процесса (SIGKILL, паника воркера): пишет поток на диск ПО ХОДУ работы, а
 * не одним атомарным блоком в конце. Именно этот сценарий делает опасной
 * запись прямо в конечный путь — там, где раньше писал `cutTrackSegment`.
 */
const h = vi.hoisted(() => ({
  behavior: "success" as "success" | "fail",
  content: "вырезанный-кусок",
  outputPaths: [] as string[],
}))

vi.mock("fluent-ffmpeg", () => {
  const makeCommand = () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    let outPath = ""
    const cmd: Record<string, unknown> = {}
    const chain = () => cmd
    Object.assign(cmd, {
      inputOptions: chain,
      audioFilters: chain,
      outputOptions: chain,
      output: (p: string) => { outPath = p; return cmd },
      on: (event: string, cb: (...args: unknown[]) => void) => {
        handlers.set(event, cb)
        return cmd
      },
      run: () => {
        h.outputPaths.push(outPath)
        setTimeout(() => {
          void (async () => {
            const { writeFile } = await import("node:fs/promises")
            if (h.behavior === "fail") {
              await writeFile(outPath, "битые-байты-оборванного-ffmpeg")
              handlers.get("error")?.(new Error("ffmpeg упал (мок)"))
              return
            }
            await writeFile(outPath, h.content)
            handlers.get("end")?.()
          })()
        }, 0)
      },
    })
    return cmd
  }
  return { default: Object.assign(() => makeCommand(), {}) }
})

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
    // Проверяем именно значения: кратность кадру прошла бы и у нетронутых границ.
    expect(cut.startSec).toBeCloseTo(37 / 30, 9) // 1.237 → 1.2333…
    expect(cut.endSec).toBeCloseTo(138 / 30, 9) // 4.611 → 4.6
    expect(cut.durationSec).toBeCloseTo(101 / 30, 9)
    expect(cut.silencePadSec).toBe(0)
    expect(cut.clampedToModel).toBe(false)
  })

  it("не вылезает за пределы трека", () => {
    const cut = planSegmentCut({
      scene: { order: 9, startSec: 58.5, endSec: 62.0, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    expect(cut.endSec).toBeLessThanOrEqual(60)
    expect(cut.endSec).toBeCloseTo(60, 9)
    // Реальный звук в куске есть: нулевой кусок прошёл бы проверку выше молча.
    expect(cut.endSec - cut.startSec).toBeCloseTo(1.5, 9)
  })

  it("короткий кусок добивает тишиной, а не чужой репликой предыдущей сцены", () => {
    const cut = planSegmentCut({
      scene: { order: 9, startSec: 58.5, endSec: 62.0, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    // Начало осталось на месте: сдвиг назад затащил бы в кусок конец соседней
    // сцены, и губы произносили бы чужие слова.
    expect(cut.startSec).toBeCloseTo(58.5, 9)
    expect(cut.silencePadSec).toBeCloseTo(0.5, 9)
    expect(cut.durationSec).toBeCloseTo(2, 9)
    expect(cut.clampedToModel).toBe("min")
  })

  it("зажимает кусок в границы модели и говорит об этом", () => {
    const cut = planSegmentCut({
      scene: { order: 2, startSec: 0, endSec: 14, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    expect(cut.durationSec).toBeLessThanOrEqual(10)
    expect(cut.durationSec).toBeCloseTo(10, 9)
    expect(cut.endSec).toBeCloseTo(10, 9)
    expect(cut.silencePadSec).toBe(0)
    // Направление зажатия обязано различаться: обрезанный хвост речи и добитая
    // тишина — разные новости для лога.
    expect(cut.clampedToModel).toBe("max")
  })

  it("пустой интервал остаётся пустым — тишиной его не добивают", () => {
    // Файл из одной тишины это оплаченная съёмка молчащих губ: такую сцену
    // вызывающий обязан отклонить, а не «дотянуть» до минимума модели.
    const cut = planSegmentCut({
      scene: { order: 3, startSec: 12, endSec: 12, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    expect(cut.durationSec).toBe(0)
    expect(cut.silencePadSec).toBe(0)
    expect(cut.clampedToModel).toBe(false)
  })

  it("ключ идентичности зависит от интервала и от самого трека, а не от текста", () => {
    const base = { videoId: 7, sceneOrder: 1, startSec: 1, endSec: 4, trackFingerprint: "abc" }

    expect(segmentIdentity(base)).toBe(segmentIdentity({ ...base }))
    expect(segmentIdentity(base)).not.toBe(segmentIdentity({ ...base, startSec: 1.5 }))
    expect(segmentIdentity(base)).not.toBe(segmentIdentity({ ...base, endSec: 4.5 }))
    expect(segmentIdentity(base)).not.toBe(segmentIdentity({ ...base, sceneOrder: 2 }))
    expect(segmentIdentity(base)).not.toBe(segmentIdentity({ ...base, videoId: 8 }))
    // Новый трек обесценивает все куски: иначе к свежему звуку подставятся
    // старые губы (spec §4.4).
    expect(segmentIdentity(base)).not.toBe(segmentIdentity({ ...base, trackFingerprint: "def" }))
  })

  it("ключ округляет границы до миллисекунды и различает соседние миллисекунды", () => {
    const base = { videoId: 7, sceneOrder: 1, startSec: 1, endSec: 4, trackFingerprint: "abc" }

    // Микродрожание внутри миллисекунды — тот же кусок, тот же ключ.
    expect(segmentIdentity({ ...base, startSec: 1.00004 })).toBe(segmentIdentity(base))
    // А целая миллисекунда — уже другой кусок.
    expect(segmentIdentity({ ...base, startSec: 1.001 })).not.toBe(segmentIdentity(base))
  })

  it("ключ различает куски с разной добивкой тишиной", () => {
    // Границы при нижнем зажатии не двигаются, отличается только тишина в хвосте:
    // модель с минимумом 2с и модель с минимумом 3с обязаны получить РАЗНЫЕ файлы,
    // иначе к трёхсекундному кадру подставится старый двухсекундный mp3.
    const base = { videoId: 7, sceneOrder: 1, startSec: 1, endSec: 2.5, trackFingerprint: "abc" }

    expect(segmentIdentity({ ...base, silencePadSec: 0.5 }))
      .not.toBe(segmentIdentity({ ...base, silencePadSec: 1.5 }))
    // Отсутствие добивки и нулевая добивка — одно и то же.
    expect(segmentIdentity({ ...base, silencePadSec: 0 })).toBe(segmentIdentity(base))
  })
})

describe("аргументы ffmpeg для вырезки", () => {
  const cutOf = (scene: { order: number, startSec: number, endSec: number }) =>
    planSegmentCut({ scene: { ...scene, words: [] }, trackDurationSec: 60, fps: 30, model: MODEL })

  it("перематывает вход к началу куска и задаёт длину выходом", () => {
    const args = buildSegmentCutArgs(cutOf({ order: 1, startSec: 1.237, endSec: 4.611 }))

    expect(args.inputOptions).toEqual(["-ss", "1.233"])
    // Именно -t: после входной перемотки -to считается по-разному в разных
    // сборках ffmpeg, а платный шаг лотереи не терпит.
    expect(args.outputOptions.slice(0, 2)).toEqual(["-t", "3.367"])
    expect(args.outputOptions).toContain("libmp3lame")
    expect(args.audioFilters).toEqual([])
  })

  it("зажатому по потолку куску фильтры не нужны — там режется, а не добивается", () => {
    const args = buildSegmentCutArgs(cutOf({ order: 2, startSec: 0, endSec: 14 }))

    expect(args.audioFilters).toEqual([])
    expect(args.outputOptions.slice(0, 2)).toEqual(["-t", "10.000"])
  })

  it("добивку тишиной кладёт в фильтр apad ровно на длину файла", () => {
    const args = buildSegmentCutArgs(cutOf({ order: 9, startSec: 58.5, endSec: 62 }))

    expect(args.inputOptions).toEqual(["-ss", "58.500"])
    expect(args.audioFilters).toEqual(["apad=whole_dur=2.000"])
    expect(args.outputOptions.slice(0, 2)).toEqual(["-t", "2.000"])
  })
})

describe("cutTrackSegment — временный файл рядом с целевым, переименование после замера", () => {
  const SCRATCH_DIR = join(tmpdir(), "cf-segment-cut-atomic")
  const trackPath = join(SCRATCH_DIR, "track.mp3")
  const outputPath = join(SCRATCH_DIR, "scene_0_track_abc123456789.mp3")
  const cut: SegmentCut = { startSec: 0, endSec: 1, durationSec: 1, silencePadSec: 0, clampedToModel: false }

  /** Временные файлы, оставшиеся рядом с целевым после прогона — их не должно быть. */
  async function tmpLeftovers(): Promise<string[]> {
    const entries = await readdir(SCRATCH_DIR)
    return entries.filter(name => name.includes(".tmp-"))
  }

  beforeEach(async () => {
    await rm(SCRATCH_DIR, { recursive: true, force: true })
    await mkdir(SCRATCH_DIR, { recursive: true })
    h.behavior = "success"
    h.content = "вырезанный-кусок"
    h.outputPaths = []
  })

  afterEach(async () => {
    await rm(SCRATCH_DIR, { recursive: true, force: true })
  })

  it("ffmpeg обрывается — по конечному пути ничего не появляется, временный подчищен", async () => {
    h.behavior = "fail"
    const probeDuration = vi.fn(async () => 1)

    await expect(cutTrackSegment({ trackPath, outputPath, cut, probeDuration }))
      .rejects.toThrow(/Не удалось вырезать/)

    // Мок пишет частичные байты по пути из .output() ДО падения — ровно как
    // настоящий ffmpeg при обрыве процесса. На конечном пути их быть не должно:
    // иначе следующий прогон принял бы огрызок за готовый кусок и отдал бы его
    // в платный lip-sync.
    expect(existsSync(outputPath)).toBe(false)
    expect(probeDuration).not.toHaveBeenCalled()
    expect(await tmpLeftovers()).toEqual([])
  })

  it("успешная вырезка: замер идёт по временному файлу, переименование — только после него", async () => {
    const probeDuration = vi.fn(async () => 3.5)

    const result = await cutTrackSegment({ trackPath, outputPath, cut, probeDuration })

    expect(result).toEqual({ path: outputPath, durationSec: 3.5 })
    expect(existsSync(outputPath)).toBe(true)
    expect(readFileSync(outputPath, "utf8")).toBe("вырезанный-кусок")
    // Замер шёл по ВРЕМЕННОМУ файлу — на момент замера rename ещё не случился.
    const measuredPath = probeDuration.mock.calls[0]?.[0] as string
    expect(measuredPath).not.toBe(outputPath)
    expect(measuredPath.startsWith(`${outputPath}.tmp-`)).toBe(true)
    expect(await tmpLeftovers()).toEqual([])
  })

  it("замер длительности провалился — конечный путь остаётся пустым, временный подчищен", async () => {
    // Файл на диске есть (ffmpeg отработал), но неизмерим — тоже падение:
    // подставлять плановую длительность и переименовывать в конечный путь
    // здесь нельзя, иначе неизмеримый кусок сойдёт за готовый навсегда.
    const probeDuration = vi.fn(async () => null)

    await expect(cutTrackSegment({ trackPath, outputPath, cut, probeDuration }))
      .rejects.toThrow(/не измеряется/)

    expect(existsSync(outputPath)).toBe(false)
    expect(await tmpLeftovers()).toEqual([])
  })

  it("два параллельных прогона режут один и тот же кусок — разные временные файлы, конечный путь не бьётся", async () => {
    const probeDuration = vi.fn(async () => 1)

    const [first, second] = await Promise.all([
      cutTrackSegment({ trackPath, outputPath, cut, probeDuration }),
      cutTrackSegment({ trackPath, outputPath, cut, probeDuration }),
    ])

    expect(first.path).toBe(outputPath)
    expect(second.path).toBe(outputPath)
    // Каждый прогон писал СВОЙ временный файл — общее имя дало бы одному
    // прогону дописать чужой недописанный файл поверх другого.
    expect(h.outputPaths).toHaveLength(2)
    expect(new Set(h.outputPaths).size).toBe(2)
    expect(existsSync(outputPath)).toBe(true)
    expect(await tmpLeftovers()).toEqual([])
  })
})
