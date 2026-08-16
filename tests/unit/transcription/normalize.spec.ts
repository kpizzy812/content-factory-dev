import { describe, expect, it } from "vitest"

import { normalizeTranscriptPayload } from "~~/server/utils/transcription/normalize"

describe("нормализация ответа модели транскрипции", () => {
  it("читает форму chunks с парой timestamp", () => {
    const result = normalizeTranscriptPayload({
      text: "привет мир",
      chunks: [
        { text: " привет", timestamp: [0, 0.42] },
        { text: " мир", timestamp: [0.42, 0.9] },
      ],
    })

    expect(result.words).toEqual([
      { text: "привет", startSec: 0, endSec: 0.42 },
      { text: "мир", startSec: 0.42, endSec: 0.9 },
    ])
    expect(result.text).toBe("привет мир")
  })

  it("читает форму segments со вложенными словами", () => {
    const result = normalizeTranscriptPayload({
      segments: [
        { start: 0, end: 1.1, text: "привет мир", words: [
          { word: "привет", start: 0, end: 0.42 },
          { word: "мир", start: 0.42, end: 0.9 },
        ] },
      ],
    })

    expect(result.words).toHaveLength(2)
    expect(result.words[1]).toEqual({ text: "мир", startSec: 0.42, endSec: 0.9 })
  })

  it("читает плоский список слов", () => {
    const result = normalizeTranscriptPayload({
      words: [{ word: "мир", start: 1, end: 1.5 }],
    })

    expect(result.words).toEqual([{ text: "мир", startSec: 1, endSec: 1.5 }])
  })

  it("собирает полный текст, если модель его не прислала", () => {
    const result = normalizeTranscriptPayload({
      words: [{ word: "привет", start: 0, end: 0.4 }, { word: "мир", start: 0.4, end: 0.9 }],
    })

    expect(result.text).toBe("привет мир")
  })

  it("отбрасывает слова без валидных границ, а не подставляет нули", () => {
    const result = normalizeTranscriptPayload({
      chunks: [
        { text: "первое", timestamp: [0, 0.5] },
        { text: "битое", timestamp: [null, null] },
        { text: "второе", timestamp: [0.6, 1.2] },
      ],
    })

    expect(result.words.map(w => w.text)).toEqual(["первое", "второе"])
  })

  it("падает внятно, когда слов нет вовсе", () => {
    expect(() => normalizeTranscriptPayload({ text: "есть текст, нет слов" }))
      .toThrow(/без границ слов/)
  })
})
