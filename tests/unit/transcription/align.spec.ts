import { describe, expect, it } from "vitest"

import { alignScriptToTranscript } from "~~/server/utils/transcription/align"
import type { Transcript } from "~~/server/utils/transcription/types"

function transcript(words: Array<[string, number, number]>): Transcript {
  return {
    words: words.map(([text, startSec, endSec]) => ({ text, startSec, endSec })),
    text: words.map(([text]) => text).join(" "),
  }
}

describe("выравнивание сценария по транскрипту", () => {
  it("даёт сценам фактические границы", () => {
    const result = alignScriptToTranscript({
      scenes: [
        { order: 1, text: "Знаешь, что отличает успешных?" },
        { order: 2, text: "Они думают о деньгах." },
      ],
      transcript: transcript([
        ["знаешь", 0, 0.4], ["что", 0.4, 0.6], ["отличает", 0.6, 1.2], ["успешных", 1.2, 1.9],
        ["они", 2.3, 2.5], ["думают", 2.5, 3.0], ["о", 3.0, 3.1], ["деньгах", 3.1, 3.8],
      ]),
    })

    expect(result.scenes[0]).toMatchObject({ order: 1, startSec: 0, endSec: 1.9 })
    expect(result.scenes[1]).toMatchObject({ order: 2, startSec: 2.3, endSec: 3.8 })
    expect(result.degraded).toBe(false)
  })

  it("отдаёт аббревиатуре все её слоги и не залезает на соседа", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "Это называется MRR сегодня" }],
      transcript: transcript([
        ["это", 0, 0.3], ["называется", 0.3, 1.0],
        ["эм", 1.0, 1.2], ["эр", 1.2, 1.4], ["эр", 1.4, 1.6],
        ["сегодня", 1.6, 2.2],
      ]),
    })

    const words = result.scenes[0]!.words
    expect(words.map(w => w.text)).toEqual(["Это", "называется", "MRR", "сегодня"])
    expect(words[2]).toMatchObject({ startSec: 1.0, endSec: 1.6, matched: true })
    // Сосед не должен начинаться раньше, чем кончилась аббревиатура.
    expect(words[3]!.startSec).toBeGreaterThanOrEqual(words[2]!.endSec)
  })

  it("отдаёт числу произнесённые слова", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "выручка 1000 долларов" }],
      transcript: transcript([
        ["выручка", 0, 0.6], ["тысяча", 0.6, 1.1], ["долларов", 1.1, 1.8],
      ]),
    })

    const words = result.scenes[0]!.words
    expect(words.map(w => w.text)).toEqual(["выручка", "1000", "долларов"])
    expect(words[1]).toMatchObject({ startSec: 0.6, endSec: 1.1, matched: true })
  })

  it("переживает проглоченное моделью слово", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "начни с малого но начни" }],
      transcript: transcript([
        ["начни", 0, 0.4], ["малого", 0.5, 1.0], ["но", 1.0, 1.1], ["начни", 1.1, 1.5],
      ]),
    })

    const words = result.scenes[0]!.words
    expect(words.map(w => w.text)).toEqual(["начни", "с", "малого", "но", "начни"])
    expect(words[1]!.matched).toBe(false)
    expect(words[1]!.startSec).toBeGreaterThanOrEqual(words[0]!.endSec)
    expect(words[1]!.endSec).toBeLessThanOrEqual(words[2]!.startSec)
  })

  it("подряд идущие несопоставленные слова делят щель, а не сливаются в точку", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "один два три четыре" }],
      transcript: transcript([["один", 0, 0.4], ["четыре", 1.6, 2.0]]),
    })

    const words = result.scenes[0]!.words
    expect(words[1]!.endSec).toBeLessThanOrEqual(words[2]!.startSec)
    expect(words[1]!.endSec - words[1]!.startSec).toBeGreaterThan(0)
    expect(words[2]!.endSec - words[2]!.startSec).toBeGreaterThan(0)
  })

  it("сцена без единого совпадения не растягивается на весь ролик", () => {
    const result = alignScriptToTranscript({
      scenes: [
        { order: 1, text: "первая сцена" },
        { order: 2, text: "неузнанная середина" },
        { order: 3, text: "третья сцена" },
      ],
      transcript: transcript([
        ["первая", 0, 0.5], ["сцена", 0.5, 1.2],
        ["третья", 2.0, 2.6], ["сцена", 2.6, 3.2],
      ]),
    })

    const middle = result.scenes[1]!
    expect(middle.startSec).toBeGreaterThanOrEqual(result.scenes[0]!.endSec)
    expect(middle.endSec).toBeLessThanOrEqual(result.scenes[2]!.startSec)
  })

  it("переживает лишнее распознанное слово", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "тело меняется" }],
      transcript: transcript([
        ["тело", 0, 0.4], ["эээ", 0.4, 0.6], ["меняется", 0.6, 1.2],
      ]),
    })

    expect(result.scenes[0]!.words.map(w => w.text)).toEqual(["тело", "меняется"])
    expect(result.scenes[0]).toMatchObject({ startSec: 0, endSec: 1.2 })
  })

  it("сообщает о деградации, когда сошлось меньше половины слов", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "совершенно другой текст сценария здесь" }],
      transcript: transcript([
        ["посторонняя", 0, 0.5], ["запись", 0.5, 1.0], ["чужого", 1.0, 1.5], ["голоса", 1.5, 2.0],
      ]),
    })

    expect(result.degraded).toBe(true)
    expect(result.matchedRatio).toBeLessThan(0.5)
    expect(result.scenes[0]!.endSec).toBeGreaterThan(0)
  })
})
