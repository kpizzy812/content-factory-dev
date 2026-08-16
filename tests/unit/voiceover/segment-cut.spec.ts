/**
 * Вырезка куска общего трека под сцену.
 *
 * Тесты из брифа усилены после ревью: проверяются ЗНАЧЕНИЯ границ, а не только
 * их кратность кадру, добивка короткого куска тишиной (раздвигать интервал по
 * треку нельзя — в кусок уехала бы чужая реплика) и чувствительность ключа к
 * каждому своему полю. Аргументы ffmpeg проверяются без запуска процесса.
 */

import { describe, expect, it } from "vitest"

import {
  buildSegmentCutArgs,
  planSegmentCut,
  segmentIdentity,
} from "~~/server/utils/voiceover/segment-cut"

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
