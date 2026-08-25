import { describe, expect, it } from "vitest"

import { buildTrackSubtitleSegments } from "~~/server/utils/edit-plan/shot-subtitles"
import type { AlignedScene } from "~~/server/utils/transcription/align"

const word = (text: string, startSec: number, endSec: number) => ({ text, startSec, endSec, matched: true })

const SCENES: AlignedScene[] = [
  { order: 1, startSec: 0.0, endSec: 2.0, words: [word("привет", 0.0, 0.7), word("это", 0.7, 1.1), word("тест", 1.1, 2.0)] },
  { order: 2, startSec: 2.0, endSec: 4.4, words: [word("вторая", 2.0, 2.9), word("сцена", 2.9, 4.4)] },
]

// Позиционно, а не по order (Critical 2, фикс-раунд 1): BY_POSITION[i] относится к SCENES[i].
const BY_POSITION = [
  { text: "привет это тест" },
  { text: "вторая сцена" },
]

describe("субтитры по абсолютному времени трека", () => {
  it("окна берутся из выравнивания, а не из длительностей клипов", () => {
    const segs = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByPosition: BY_POSITION })
    expect(segs[0]!.startSec).toBeCloseTo(0.0, 6)
    expect(segs.at(-1)!.endSec).toBeCloseTo(4.4, 6)
  })

  it("сегменты идут по возрастанию времени и не перехлёстываются", () => {
    const segs = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByPosition: BY_POSITION })
    for (let i = 1; i < segs.length; i += 1) {
      expect(segs[i]!.startSec).toBeGreaterThanOrEqual(segs[i - 1]!.endSec - 1e-9)
    }
  })

  it("слова чанка — РЕАЛЬНЫЕ тайминги выравнивания, а не равномерная оценка", () => {
    const segs = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByPosition: BY_POSITION })
    const words = segs[0]!.words
    expect(words).toBeDefined()
    expect(words!.some(w => Math.abs(w.startSec - 0.7) < 1e-6)).toBe(true)
  })

  it("сцена без текста сценария субтитра не даёт и хвост не сдвигает", () => {
    const segs = buildTrackSubtitleSegments({
      alignedScenes: SCENES, scenesByPosition: [undefined, { text: "вторая сцена" }],
    })
    expect(segs).toHaveLength(1)
    expect(segs[0]!.startSec).toBeCloseTo(2.0, 6)
  })

  it("позиции без записи в scenesByPosition субтитра не получают", () => {
    // Массив короче alignedScenes — позиция 1 не задана вовсе (не только текст пуст).
    const segs = buildTrackSubtitleSegments({
      alignedScenes: SCENES, scenesByPosition: [{ text: "привет это тест" }],
    })
    expect(segs.every(s => s.text !== "вторая сцена")).toBe(true)
  })

  it("позиционного сопоставления во ВХОДНОМ МАССИВЕ нет: перестановка сцен (вместе со своим текстом) не меняет результат", () => {
    // Текст едет ВМЕСТЕ со своей сценой — это не то же самое, что «порядок массива не важен
    // вовсе»: buildTrackSubtitleSegments сортирует по startSec внутри себя, и результат не
    // должен зависеть от того, в каком порядке вызывающий передал сцены на входе.
    const reversedScenes = [SCENES[1]!, SCENES[0]!]
    const reversedByPosition = [BY_POSITION[1]!, BY_POSITION[0]!]
    const a = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByPosition: BY_POSITION })
    const b = buildTrackSubtitleSegments({ alignedScenes: reversedScenes, scenesByPosition: reversedByPosition })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it("пустое выравнивание даёт пустой список, а не бросает", () => {
    expect(buildTrackSubtitleSegments({ alignedScenes: [], scenesByPosition: [] })).toEqual([])
  })

  // Сверх брифа (мутационная проверка домена теста, задача-контроллер §9): «сцена
  // без текста сценария субтитра не даёт» выше проверяет только ОТСУТСТВУЮЩУЮ позицию
  // scenesByPosition — мутация «убрать проверку text.length===0, оставить только
  // !source» на ней НЕ краснеет (`!source` уже true у отсутствующей позиции само по
  // себе). Различает мутацию только позиция, которая ЗАДАНА, но с пустым/пробельным
  // текстом — ровно то, что реально бывает: оператор вычистил subtitleCopy пустой
  // строкой (см. runAssembly, ruling про POST /edit-subtitles).
  it("позиция ЕСТЬ в scenesByPosition, но текст пуст/пробельный — субтитра тоже не даёт", () => {
    const segs = buildTrackSubtitleSegments({
      alignedScenes: SCENES,
      scenesByPosition: [{ text: "   " }, { text: "вторая сцена" }],
    })
    expect(segs).toHaveLength(1)
    expect(segs[0]!.text).toBe("вторая сцена")
  })

  // Фикс-раунд 1, Critical 2 (ревью): AlignedScene.order может дублироваться —
  // задокументированная реальность проекта (align.ts). Сопоставление ПО ORDER
  // положило бы текст одной сцены на речь другой; позиционное сопоставление
  // (scenesByPosition[i] ↔ alignedScenes[i]) этого не допускает по построению.
  it("дубль order у сцен — каждая получает СВОЙ текст, а не текст соседки", () => {
    const dupOrderScenes: AlignedScene[] = [
      { order: 1, startSec: 0, endSec: 2, words: [] },
      { order: 1, startSec: 2, endSec: 4, words: [] },
      { order: 2, startSec: 4, endSec: 6, words: [] },
    ]
    const byPosition = [
      { text: "первая сцена" },
      { text: "вторая сцена" },
      { text: "третья сцена" },
    ]
    const segs = buildTrackSubtitleSegments({ alignedScenes: dupOrderScenes, scenesByPosition: byPosition })
    expect(segs.map(s => s.text)).toEqual(["первая сцена", "вторая сцена", "третья сцена"])
  })

  // Important 4 (ревью): фикстуры выше дают РОВНО ОДИН чанк на сцену (окно чанка
  // случайно совпадает с окном сцены), поэтому мутация «wordsForChunk получает
  // окно СЦЕНЫ вместо окна ЧАНКА» на них не отличима. Сцена ниже даёт ДВА чанка —
  // числа взяты из живого прогона ревьюера (`task-6-review.md`, §3.1): фразы 27 и
  // 25 символов, окно 6.000с даёт границу chunkSceneSpeech на 13.1154с.
  it("многочанковая сцена: слова второго чанка привязаны к ОКНУ ЧАНКА, а не окну сцены", () => {
    const multiChunkScene: AlignedScene = {
      order: 1,
      startSec: 10.0,
      endSec: 16.0,
      words: [
        word("Сегодня", 10.00, 10.60),
        word("мы", 10.60, 10.80),
        word("разберём", 10.80, 11.60),
        word("бюджет.", 11.60, 12.40),
        word("Дальше", 12.60, 13.20),
        word("идёт", 13.20, 13.60),
        word("вторая", 13.60, 14.20),
        word("часть.", 14.20, 16.00),
      ],
    }
    const segs = buildTrackSubtitleSegments({
      alignedScenes: [multiChunkScene],
      scenesByPosition: [{ text: "Сегодня мы разберём бюджет. Дальше идёт вторая часть." }],
    })
    expect(segs).toHaveLength(2)
    expect(segs[0]!.text).toBe("Сегодня мы разберём бюджет.")
    expect(segs[1]!.text).toBe("Дальше идёт вторая часть.")

    // Второй чанк короче суммы реальных длительностей своих слов (0.6+0.4+0.6+1.8=3.4с
    // при окне ýже — fitWithinWindow обязана сжать их и уложить С НАЧАЛА ОКНА ЧАНКА
    // (aligned-words.ts:98). Если бы вместо окна чанка передали окно ВСЕЙ сцены
    // (10.0..16.0, 6с — с запасом), сжатия не потребовалось бы вовсе, и первое слово
    // чанка вернулось бы с РЕАЛЬНЫМ (несжатым) таймингом 12.60 — тем самым, что
    // предшествует границе чанка. Различие наблюдаемо: с верным окном первое слово
    // чанка стартует ровно на границе чанка.
    expect(segs[1]!.words).toBeDefined()
    expect(segs[1]!.words![0]!.startSec).toBeCloseTo(segs[1]!.startSec, 3)
    expect(segs[1]!.words![0]!.startSec).not.toBeCloseTo(12.60, 1)

    // Слова каждого чанка не перетекают в соседний — по содержанию.
    expect(segs[0]!.words!.map(w => w.text)).toEqual(["Сегодня", "мы", "разберём", "бюджет."])
    expect(segs[1]!.words!.map(w => w.text)).toEqual(["Дальше", "идёт", "вторая", "часть."])
  })
})
