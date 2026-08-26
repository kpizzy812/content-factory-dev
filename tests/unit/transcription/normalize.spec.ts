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

  /**
   * Реальная форма ответа `victor-upmeet/whisperx` с `align_output: true`.
   *
   * Форма НЕ угадана: снята из исходного кода — `predict.py` репозитория
   * `victor-upmeet/whisperx-replicate` возвращает
   * `Output(segments=result["segments"], detected_language=detected_language)`,
   * где при `align_output=True` `result = whisperx.align(...)` из
   * `m-bain/whisperX` (`whisperx/alignment.py:424`):
   * `return {"segments": aligned_segments, "word_segments": word_segments}`.
   * Каждый элемент `aligned_segments` — `{text, start, end, words: [...]}}`
   * (`alignment.py:384-389`), а каждое слово — `{word, start?, end?, score?}`
   * (`alignment.py:360-367`): `start`/`end` добавляются условно, только если
   * значение не NaN после интерполяции.
   */
  it("читает реальную форму victor-upmeet/whisperx (align_output: true) — снято из predict.py и whisperx/alignment.py", () => {
    const result = normalizeTranscriptPayload({
      segments: [
        {
          text: "привет мир",
          start: 0,
          end: 0.9,
          words: [
            { word: "привет", start: 0, end: 0.42, score: 0.9 },
            { word: "мир", start: 0.42, end: 0.9, score: 0.87 },
          ],
        },
        {
          text: "как дела",
          start: 1.1,
          end: 1.8,
          words: [
            { word: "как", start: 1.1, end: 1.3, score: 0.95 },
            { word: "дела", start: 1.3, end: 1.8, score: 0.91 },
          ],
        },
      ],
      detected_language: "ru",
    })

    expect(result.words).toEqual([
      { text: "привет", startSec: 0, endSec: 0.42 },
      { text: "мир", startSec: 0.42, endSec: 0.9 },
      { text: "как", startSec: 1.1, endSec: 1.3 },
      { text: "дела", startSec: 1.3, endSec: 1.8 },
    ])
    expect(result.text).toBe("привет мир как дела")
  })

  it("сегмент whisperx, который не удалось выровнять, отдаёт words: [] — слова сегмента просто отсутствуют в транскрипте", () => {
    // alignment.py:236-244/294-297: при неудаче выравнивания сегмент
    // возвращается со start/end/text, но words: [] (без per-word таймингов).
    const result = normalizeTranscriptPayload({
      segments: [
        { text: "первый", start: 0, end: 0.5, words: [{ word: "первый", start: 0, end: 0.5 }] },
        { text: "не выровнялось", start: 0.6, end: 1.2, words: [] },
        { text: "третий", start: 1.3, end: 1.9, words: [{ word: "третий", start: 1.3, end: 1.9 }] },
      ],
    })

    expect(result.words.map(w => w.text)).toEqual(["первый", "третий"])
  })
})
