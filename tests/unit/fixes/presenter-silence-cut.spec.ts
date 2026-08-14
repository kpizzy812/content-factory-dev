/**
 * Резка записи ведущей по речевым паузам.
 *
 * Ингест резал только по видеосклейкам (`ffmpeg select='gt(scene,T)'`), а
 * съёмка ведущей — это один непрерывный дубль на одном фоне: склеек в нём нет
 * вовсе. Детектор возвращал пустой список, и планировщик рубил запись на равные
 * куски по таймеру — посреди слова и посреди жеста.
 *
 * Границы фраз в такой записи размечает не картинка, а звук: паузы между
 * репликами. Режем по серединам пауз — тогда у фрагмента остаётся запас тишины
 * с обеих сторон, рот на границах закрыт, жест целый.
 */

import { describe, expect, it, vi } from "vitest"

import {
  parseSilenceRangesFromStderr,
  silenceCutPoints,
} from "~~/server/utils/video-tools/silence-detect"
import { ingestPresenterRecording } from "~~/server/utils/presenter/ingest-runner"
import { DHASH_HEIGHT, DHASH_WIDTH } from "~~/server/utils/presenter/perceptual-hash"

/** Кадр из детерминированного LCG — как в тестах ингеста: разные seed, разные хеши. */
function grayFrame(seed: number): Uint8Array {
  const pixels = new Uint8Array(DHASH_WIDTH * DHASH_HEIGHT)
  let state = (seed * 7919 + 13) % 2147483647 || 1
  for (let i = 0; i < pixels.length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648
    pixels[i] = state % 256
  }
  return pixels
}

describe("разбор silencedetect", () => {
  it("собирает паузы из пар start/end", () => {
    const stderr = [
      "[silencedetect @ 0x55c] silence_start: 4.512",
      "[silencedetect @ 0x55c] silence_end: 5.238 | silence_duration: 0.726",
      "[silencedetect @ 0x55c] silence_start: 11.04",
      "[silencedetect @ 0x55c] silence_end: 12.5 | silence_duration: 1.46",
    ].join("\n")

    expect(parseSilenceRangesFromStderr(stderr)).toEqual([
      { startSec: 4.51, endSec: 5.24 },
      { startSec: 11.04, endSec: 12.5 },
    ])
  })

  it("незакрытая пауза в конце записи не даёт мусорного диапазона", () => {
    // ffmpeg печатает silence_start и обрывается на EOF, если запись кончается
    // тишиной. Диапазон без конца — не диапазон.
    const stderr = [
      "[silencedetect @ 0x55c] silence_start: 4.5",
      "[silencedetect @ 0x55c] silence_end: 5.2 | silence_duration: 0.7",
      "[silencedetect @ 0x55c] silence_start: 58.3",
    ].join("\n")

    expect(parseSilenceRangesFromStderr(stderr)).toEqual([{ startSec: 4.5, endSec: 5.2 }])
  })

  it("отрицательный старт около нуля приводится к нулю", () => {
    // Запись, начинающаяся с тишины, даёт silence_start: -0.00012.
    const stderr = [
      "[silencedetect @ 0x55c] silence_start: -0.00012",
      "[silencedetect @ 0x55c] silence_end: 1.2 | silence_duration: 1.2",
    ].join("\n")

    expect(parseSilenceRangesFromStderr(stderr)).toEqual([{ startSec: 0, endSec: 1.2 }])
  })

  it("пустой вывод — пустой список, а не исключение", () => {
    expect(parseSilenceRangesFromStderr("")).toEqual([])
    expect(parseSilenceRangesFromStderr("ffmpeg version 7.1\nno silence here")).toEqual([])
  })
})

describe("точки реза по паузам", () => {
  it("режет по середине паузы, а не по краю", () => {
    // Край паузы означал бы, что фрагмент начинается ровно на первом звуке:
    // рот уже открыт, вступление рваное. Середина оставляет запас с обеих сторон.
    expect(silenceCutPoints([{ startSec: 4, endSec: 5 }], { durationSec: 30 }))
      .toEqual([4.5])
  })

  it("тишина в начале и в конце записи точек реза не даёт", () => {
    // Резать нечего: слева от первой паузы и справа от последней нет речи.
    const points = silenceCutPoints([
      { startSec: 0, endSec: 1.4 },
      { startSec: 12, endSec: 13 },
      { startSec: 58.6, endSec: 60 },
    ], { durationSec: 60 })

    expect(points).toEqual([12.5])
  })

  it("вдох короче минимума за границу фразы не считается", () => {
    const points = silenceCutPoints([
      { startSec: 10, endSec: 10.15 },
      { startSec: 20, endSec: 21 },
    ], { durationSec: 40, minSilenceSec: 0.4 })

    expect(points).toEqual([20.5])
  })

  it("точки идут по возрастанию и без дублей", () => {
    const points = silenceCutPoints([
      { startSec: 20, endSec: 21 },
      { startSec: 5, endSec: 6 },
      { startSec: 20, endSec: 21 },
    ], { durationSec: 40 })

    expect(points).toEqual([5.5, 20.5])
  })
})

describe("ингест режет по паузам, а склейки оставляет запасным путём", () => {
  function deps(overrides: Record<string, unknown> = {}) {
    let seed = 0
    return {
      probeDuration: vi.fn(async () => 20),
      detectScenes: vi.fn(async () => []),
      detectSilence: vi.fn(async () => [7]),
      cutSegment: vi.fn(async () => {}),
      grayscaleThumbnail: vi.fn(async () => grayFrame((seed += 1))),
      ...overrides,
    }
  }

  const input = { recordingPath: "/tmp/take.mov", outputDir: "/tmp/out" }

  it("паузы найдены — режем по ним и склейки не ищем вовсе", async () => {
    // Разметка склеек декодирует каждый кадр: на записи 4K60 это десятки минут
    // работы ради заведомо пустого ответа. Детектор пауз читает только звук.
    const d = deps()
    const result = await ingestPresenterRecording(input, d as never)

    expect(result.boundarySource).toBe("silence")
    expect(d.detectScenes).not.toHaveBeenCalled()
    // Пауза на 7-й секунде дала границу, но кусок 7-20 длиннее потолка модели
    // (10 с) и делится пополам: пауза задаёт ГДЕ резать, а не отменяет предел.
    expect(result.clips.map(c => [c.startSec, c.endSec])).toEqual([
      [0, 7], [7, 13.5], [13.5, 20],
    ])
  })

  it("пауз не нашлось — падаем на склейки, прежнее поведение", async () => {
    const d = deps({
      detectSilence: vi.fn(async () => []),
      detectScenes: vi.fn(async () => [10]),
    })
    const result = await ingestPresenterRecording(input, d as never)

    expect(result.boundarySource).toBe("scene")
    expect(d.detectScenes).toHaveBeenCalled()
    expect(result.clips.map(c => [c.startSec, c.endSec])).toEqual([[0, 10], [10, 20]])
  })

  it("детектор пауз упал — это не отменяет нарезку", async () => {
    const d = deps({
      detectSilence: vi.fn(async () => { throw new Error("ffmpeg умер") }),
      detectScenes: vi.fn(async () => [10]),
    })
    const result = await ingestPresenterRecording(input, d as never)

    expect(result.boundarySource).toBe("scene")
    expect(result.clips).toHaveLength(2)
  })

  it("без детектора пауз контур работает как раньше", async () => {
    // Зависимость необязательная: вызывающие, которые её не передали,
    // не должны сломаться.
    const d = deps({ detectSilence: undefined, detectScenes: vi.fn(async () => [10]) })
    const result = await ingestPresenterRecording(input, d as never)

    expect(result.boundarySource).toBe("scene")
    expect(result.clips).toHaveLength(2)
  })
})
