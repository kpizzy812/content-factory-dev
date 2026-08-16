import { describe, expect, it } from "vitest"

import { wordsForChunk } from "~~/server/utils/subtitles/aligned-words"

const SCENE_WORDS = [
  { text: "короткое", startSec: 0, endSec: 0.5, matched: true },
  { text: "и", startSec: 0.5, endSec: 0.6, matched: true },
  { text: "очень", startSec: 0.6, endSec: 1.0, matched: true },
  { text: "длинное", startSec: 1.0, endSec: 1.8, matched: true },
]

describe("раскладка выровненных слов по чанкам субтитра", () => {
  it("отдаёт чанку только его слова", () => {
    const words = wordsForChunk({
      words: SCENE_WORDS,
      chunkText: "очень длинное",
      chunkStartSec: 0.6,
      chunkEndSec: 1.8,
    })

    expect(words.map(w => w.text)).toEqual(["очень", "длинное"])
    expect(words[0]).toMatchObject({ startSec: 0.6, endSec: 1.0 })
  })

  it("сохраняет реальную неравномерность длительностей", () => {
    const words = wordsForChunk({
      words: SCENE_WORDS,
      chunkText: "короткое и",
      chunkStartSec: 0,
      chunkEndSec: 0.6,
    })

    // Союз звучит 0.1 с — равномерная оценка дала бы ему 0.3 и увела бы
    // караоке-подсветку.
    expect(words[1]!.endSec - words[1]!.startSec).toBeCloseTo(0.1, 3)
  })

  it("возвращает пустой список, когда слова чанка не нашлись", () => {
    const words = wordsForChunk({
      words: SCENE_WORDS,
      chunkText: "совсем другое",
      chunkStartSec: 0,
      chunkEndSec: 1,
    })

    // Пустой список — сигнал билдеру оценить тайминги по-старому, а не повод
    // подсветить случайные слова.
    expect(words).toEqual([])
  })
})
