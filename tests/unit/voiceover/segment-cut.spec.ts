/**
 * Вырезка куска общего трека под сцену.
 *
 * Тесты из брифа усилены после ревью: проверяются ЗНАЧЕНИЯ границ, а не только
 * их кратность кадру, добивка короткого куска тишиной (раздвигать интервал по
 * треку нельзя — в кусок уехала бы чужая реплика) и чувствительность ключа к
 * каждому своему полю. Аргументы ffmpeg проверяются без запуска процесса.
 */

import { existsSync, readFileSync } from "node:fs"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildSegmentCutArgs,
  buildTempSegmentPath,
  cutTrackSegment,
  planSegmentCut,
  renameWithRetry,
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
    const base = outputPath.slice(0, -".mp3".length)
    expect(measuredPath.startsWith(`${base}.tmp-`)).toBe(true)
    // Расширение обязано остаться ПОСЛЕДНИМ символом пути: суффикс после
    // .mp3 лишает настоящий ffmpeg расширения выходного файла, и он
    // отказывается писать вовсе ("Unable to choose an output format") — мок
    // этого не ловит, потому что пишет по любому пути, который ему дали.
    expect(measuredPath.endsWith(".mp3")).toBe(true)
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

describe("buildTempSegmentPath — расширение остаётся последним символом пути", () => {
  it("суффикс встаёт ПЕРЕД расширением, а не после него", () => {
    const tempPath = buildTempSegmentPath("/assets/scene_0_track_abc123456789.mp3")

    // Настоящий ffmpeg выбирает муксер по расширению ВЫХОДНОГО пути
    // (buildSegmentCutArgs не задаёт -f явно): суффикс после .mp3 лишает его
    // расширения вовсе, и запись падает ("Unable to choose an output format").
    expect(tempPath).toMatch(/^\/assets\/scene_0_track_abc123456789\.tmp-[0-9a-f-]+\.mp3$/)
    expect(tempPath.endsWith(".mp3")).toBe(true)
  })

  it("два вызова на один и тот же путь дают разные временные файлы", () => {
    const a = buildTempSegmentPath("/assets/seg.mp3")
    const b = buildTempSegmentPath("/assets/seg.mp3")

    expect(a).not.toBe(b)
  })

  it("путь без расширения — суффикс добавляется на конец, без .undefined", () => {
    const tempPath = buildTempSegmentPath("/assets/seg")

    expect(tempPath).toMatch(/^\/assets\/seg\.tmp-[0-9a-f-]+$/)
  })
})

describe("renameWithRetry — повтор переименования при EPERM/EBUSY", () => {
  function errnoError(code: string): NodeJS.ErrnoException {
    const err = new Error(`${code}: смоделированная ошибка переименования`) as NodeJS.ErrnoException
    err.code = code
    return err
  }

  it("EPERM на первой попытке — второй попытки достаточно для успеха", async () => {
    let calls = 0
    const renameFile = vi.fn(async () => {
      calls++
      if (calls === 1) throw errnoError("EPERM")
    })

    await renameWithRetry("/tmp/a.mp3.tmp-1.mp3", "/tmp/a.mp3", 5, renameFile)

    expect(renameFile).toHaveBeenCalledTimes(2)
    expect(renameFile).toHaveBeenNthCalledWith(1, "/tmp/a.mp3.tmp-1.mp3", "/tmp/a.mp3")
    expect(renameFile).toHaveBeenNthCalledWith(2, "/tmp/a.mp3.tmp-1.mp3", "/tmp/a.mp3")
  })

  it("EBUSY на каждой попытке — исчерпание бросает исходную ошибку, а не глотает её", async () => {
    const renameFile = vi.fn(async () => { throw errnoError("EBUSY") })

    await expect(renameWithRetry("/tmp/a.mp3.tmp-1.mp3", "/tmp/a.mp3", 3, renameFile))
      .rejects.toMatchObject({ code: "EBUSY" })
    expect(renameFile).toHaveBeenCalledTimes(3)
  })

  it("ошибка, не связанная с блокировкой файла, пробрасывается сразу — без единого повтора", async () => {
    const renameFile = vi.fn(async () => { throw errnoError("ENOENT") })

    await expect(renameWithRetry("/tmp/a.mp3.tmp-1.mp3", "/tmp/a.mp3", 5, renameFile))
      .rejects.toMatchObject({ code: "ENOENT" })
    expect(renameFile).toHaveBeenCalledTimes(1)
  })
})

/**
 * Мелочь 5.4 из долга плана A: скачивание записи ведущего в lip-sync-runner.ts
 * (localRecordingPath, строки ~1031-1036 и recordingPath второй попытки в
 * guard, строки ~1084-1091) переиспользует ЭТИ ЖЕ buildTempSegmentPath +
 * renameWithRetry для temp+rename, а не собственную реализацию ("третьей
 * копии не пишем" — докстринг в lip-sync-runner.ts). Сам раннер тестом не
 * бьём: он не подлежит распиливанию ради теста (см. бриф долга плана A), а
 * статический импорт ffmpeg-цепочки оттуда запрещён отдельным правилом
 * проекта. Атомарность поэтому проверяется здесь, на уровне используемого им
 * хелпера — покрыт хелпер, а не сам вызов из раннера.
 *
 * Important 1, фикс-раунд 1 ревью: первая версия этого блока оборачивала
 * вызов в try/catch, ПОВТОРЯЮЩИЙ код раннера внутри теста — мок закачки бросал
 * ДО вызова renameWithRetry, и настоящая функция вообще не исполнялась (тест
 * проверял только сам себя: что try/catch/unlink теста работает). Ниже —
 * тесты, которые реально вызывают продакшн `renameWithRetry` и проверяют его
 * настоящий результат на диске, а не переписанную копию.
 */
describe("temp+rename для скачивания записи ведущего (lip-sync-runner.ts) — атомарность на уровне хелпера", () => {
  const SCRATCH_DIR = join(tmpdir(), "cf-recording-download-atomic")

  beforeEach(async () => {
    await rm(SCRATCH_DIR, { recursive: true, force: true })
    await mkdir(SCRATCH_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(SCRATCH_DIR, { recursive: true, force: true })
  })

  it("временного файла нет к моменту renameWithRetry (закачка не успела его дописать) — целевой путь не появляется из ничего", async () => {
    const localRecordingPath = join(SCRATCH_DIR, "recording_missing789.mp4")
    const missingTempPath = buildTempSegmentPath(localRecordingPath)
    // temp НЕ создаём вовсе — имитирует обрыв закачки ДО того, как она успела
    // дописать временный файл (сеть легла на первом байте, процесс убит и
    // т.п.). Вызываем настоящий renameWithRetry, а не копию: ENOENT не входит
    // в EPERM/EBUSY-повтор (см. describe выше), падает на первой попытке.

    await expect(renameWithRetry(missingTempPath, localRecordingPath))
      .rejects.toMatchObject({ code: "ENOENT" })

    // Главное: провалившийся renameWithRetry не создаёт целевой файл из
    // ничего — атомарность здесь гарантирует сам fs.rename (один syscall), а
    // не обвязка вокруг него. Если бы lip-sync-runner.ts вместо temp+rename
    // качал прямо в целевой путь (ровно тот дефект, ради которого заведена
    // эта мелочь), этой гарантии не было бы вовсе — обрыв мог бы оставить
    // огрызок ПОД целевым именем, и следующий прогон принял бы его за готовую
    // запись.
    expect(existsSync(localRecordingPath)).toBe(false)
  })

  it("временный файл записан целиком, но переименование падает (гонка/блокировка) — целевой путь остаётся нетронутым, не обрезанным", async () => {
    const localRecordingPath = join(SCRATCH_DIR, "recording_raced321.mp4")
    const tempRecordingPath = buildTempSegmentPath(localRecordingPath)
    await writeFile(tempRecordingPath, "нормализованная-запись-целиком")

    // renameFile-инъекция (тот же параметр, что и в describe "повтор
    // переименования" выше) — не хендрайтный дубль продакшн-кода: это
    // настоящий 4-й параметр renameWithRetry, продакшн `lip-sync-runner.ts`
    // просто не передаёт его и получает дефолтный `rename` из node:fs/promises.
    // Здесь имитируем ситуацию "переименование в принципе невозможно"
    // (например ENOENT на исчезнувшем во время гонки temp-файле) — цель не в
    // причине отказа (она уже покрыта тестами EPERM/EBUSY/ENOENT ниже), а в
    // том, что провалившийся rename не оставляет обрезанный файл по целевому
    // пути, даже когда временный файл был записан полностью.
    const renameFile = async () => { throw Object.assign(new Error("рукотворный отказ переименования"), { code: "ENOENT" }) }

    await expect(renameWithRetry(tempRecordingPath, localRecordingPath, 1, renameFile))
      .rejects.toMatchObject({ code: "ENOENT" })

    expect(existsSync(localRecordingPath)).toBe(false)
  })

  it("успешная закачка: целевой путь появляется только ПОСЛЕ renameWithRetry, не раньше", async () => {
    const localRecordingPath = join(SCRATCH_DIR, "recording_ok456.mp4")
    const tempRecordingPath = buildTempSegmentPath(localRecordingPath)

    await writeFile(tempRecordingPath, "нормализованная-запись-целиком")
    // До переименования целевого пути ещё нет — иначе параллельный fileExists()
    // в раннере принял бы недокачанный temp за готовую запись.
    expect(existsSync(localRecordingPath)).toBe(false)

    await renameWithRetry(tempRecordingPath, localRecordingPath)

    expect(existsSync(localRecordingPath)).toBe(true)
    expect(existsSync(tempRecordingPath)).toBe(false)
    expect(readFileSync(localRecordingPath, "utf8")).toBe("нормализованная-запись-целиком")
  })
})
