import { describe, expect, it } from "vitest"
import { chunkSceneSpeech, maxCharsForWidth } from "../../../server/utils/subtitles/phrase-chunker"

/** Реальная реплика из canary-сценария — на ней и вылезала ширина. */
const SCENE_LINE = "Йогурт ноль процентов убирает жир, но компенсирует вкус сахаром — его здесь на треть больше, чем в обычном"

describe("нарезка реплики на субтитры", () => {
  it("режет реплику сцены на короткие фразы вместо одного блока", () => {
    const chunks = chunkSceneSpeech(SCENE_LINE, 0, 9)

    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(32)
    }
    // Текст сохраняется целиком: субтитр обязан совпадать с речью слово в слово.
    expect(chunks.map(c => c.text).join(" ")).toBe(SCENE_LINE)
  })

  it("укладывает фразы в окно сцены без наложений и разрывов", () => {
    const chunks = chunkSceneSpeech(SCENE_LINE, 12, 21)

    expect(chunks[0]!.startSec).toBe(12)
    expect(chunks.at(-1)!.endSec).toBe(21)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startSec).toBe(chunks[i - 1]!.endSec)
      expect(chunks[i]!.endSec).toBeGreaterThan(chunks[i]!.startSec)
    }
  })

  it("предпочитает границу по концу предложения", () => {
    const chunks = chunkSceneSpeech("Три месяца только полезное. Вес стоит на месте.", 0, 6)

    expect(chunks[0]!.text).toBe("Три месяца только полезное.")
    expect(chunks[1]!.text).toBe("Вес стоит на месте.")
  })

  it("не рвёт слово, которое само длиннее лимита", () => {
    const chunks = chunkSceneSpeech("Гиперхолестеринемия развивается годами", 0, 4, { maxChars: 12 })

    expect(chunks[0]!.text).toBe("Гиперхолестеринемия")
    expect(chunks.map(c => c.text).join(" ")).toBe("Гиперхолестеринемия развивается годами")
  })

  it("показывает каждую фразу заметное время, а не мельканием", () => {
    const chunks = chunkSceneSpeech(SCENE_LINE, 0, 9)

    for (const chunk of chunks) {
      expect(chunk.endSec - chunk.startSec).toBeGreaterThanOrEqual(0.7)
    }
  })

  it("не растягивает фразы за пределы сцены, если их слишком много", () => {
    const chunks = chunkSceneSpeech(SCENE_LINE, 0, 2)

    expect(chunks.at(-1)!.endSec).toBe(2)
    for (const chunk of chunks) {
      expect(chunk.endSec).toBeLessThanOrEqual(2)
    }
  })

  it("не оставляет предлог в конце фразы", () => {
    const chunks = chunkSceneSpeech(
      "Она делает всё, что советуют: салаты вместо фастфуда, йогурты без жира",
      0, 9,
    )

    for (const chunk of chunks) {
      const lastWord = chunk.text.split(/\s+/).at(-1)!.toLowerCase()
      expect(["вместо", "без", "что", "и", "на", "в"]).not.toContain(lastWord)
    }
    expect(chunks.map(c => c.text).join(" "))
      .toBe("Она делает всё, что советуют: салаты вместо фастфуда, йогурты без жира")
  })

  it("не выносит одинокий предлог отдельной фразой", () => {
    const chunks = chunkSceneSpeech("Сахара здесь на треть больше чем в", 0, 5, { maxChars: 16 })

    for (const chunk of chunks) {
      expect(chunk.text.split(/\s+/).length).toBeGreaterThan(1)
    }
  })

  it("на пустой реплике не выдаёт ничего", () => {
    expect(chunkSceneSpeech("   ", 0, 5)).toEqual([])
  })
})

describe("лимит символов по ширине кадра", () => {
  it("считает потолок под вертикальный кадр", () => {
    // 1080 минус поля по 60 = 960 полезных пикселей при кегле 62.
    expect(maxCharsForWidth(1080, 62, 60)).toBe(28)
  })

  it("на крупном кегле пускает в строку меньше символов", () => {
    expect(maxCharsForWidth(1080, 80, 60)).toBeLessThan(maxCharsForWidth(1080, 56, 60))
  })
})
