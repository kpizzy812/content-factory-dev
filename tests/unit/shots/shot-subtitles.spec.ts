import { describe, expect, it } from "vitest"

import { buildTrackSubtitleSegments } from "~~/server/utils/edit-plan/shot-subtitles"
import type { AlignedScene } from "~~/server/utils/transcription/align"

const word = (text: string, startSec: number, endSec: number) => ({ text, startSec, endSec, matched: true })

const SCENES: AlignedScene[] = [
  { order: 1, startSec: 0.0, endSec: 2.0, words: [word("привет", 0.0, 0.7), word("это", 0.7, 1.1), word("тест", 1.1, 2.0)] },
  { order: 2, startSec: 2.0, endSec: 4.4, words: [word("вторая", 2.0, 2.9), word("сцена", 2.9, 4.4)] },
]

const BY_ORDER = new Map([
  [1, { text: "привет это тест" }],
  [2, { text: "вторая сцена" }],
])

describe("субтитры по абсолютному времени трека", () => {
  it("окна берутся из выравнивания, а не из длительностей клипов", () => {
    const segs = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByOrder: BY_ORDER })
    expect(segs[0]!.startSec).toBeCloseTo(0.0, 6)
    expect(segs.at(-1)!.endSec).toBeCloseTo(4.4, 6)
  })

  it("сегменты идут по возрастанию времени и не перехлёстываются", () => {
    const segs = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByOrder: BY_ORDER })
    for (let i = 1; i < segs.length; i += 1) {
      expect(segs[i]!.startSec).toBeGreaterThanOrEqual(segs[i - 1]!.endSec - 1e-9)
    }
  })

  it("слова чанка — РЕАЛЬНЫЕ тайминги выравнивания, а не равномерная оценка", () => {
    const segs = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByOrder: BY_ORDER })
    const words = segs[0]!.words
    expect(words).toBeDefined()
    expect(words!.some(w => Math.abs(w.startSec - 0.7) < 1e-6)).toBe(true)
  })

  it("сцена без текста сценария субтитра не даёт и хвост не сдвигает", () => {
    const segs = buildTrackSubtitleSegments({
      alignedScenes: SCENES, scenesByOrder: new Map([[2, { text: "вторая сцена" }]]),
    })
    expect(segs).toHaveLength(1)
    expect(segs[0]!.startSec).toBeCloseTo(2.0, 6)
  })

  it("сцена, которой нет в выравнивании, субтитра не получает — время неизвестно", () => {
    const segs = buildTrackSubtitleSegments({
      alignedScenes: [SCENES[0]!],
      scenesByOrder: new Map([[1, { text: "привет это тест" }], [9, { text: "чужая" }]]),
    })
    expect(segs.every(s => s.text !== "чужая")).toBe(true)
  })

  it("позиционного сопоставления нет вовсе: перестановка сцен ничего не двигает", () => {
    const reversed = [SCENES[1]!, SCENES[0]!]
    const a = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByOrder: BY_ORDER })
    const b = buildTrackSubtitleSegments({ alignedScenes: reversed, scenesByOrder: BY_ORDER })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it("пустое выравнивание даёт пустой список, а не бросает", () => {
    expect(buildTrackSubtitleSegments({ alignedScenes: [], scenesByOrder: BY_ORDER })).toEqual([])
  })

  // Сверх брифа (мутационная проверка домена теста, задача-контроллер §9): «сцена
  // без текста сценария субтитра не даёт» выше проверяет только ОТСУТСТВУЮЩИЙ ключ
  // scenesByOrder — мутация «убрать проверку text.length===0, оставить только !source»
  // на ней НЕ краснеет (`!source` уже true у отсутствующего ключа само по себе).
  // Различает мутацию только сцена, которая В КАРТЕ ЕСТЬ, но с пустым/пробельным
  // текстом — ровно то, что реально бывает: оператор вычистил subtitleCopy пустой
  // строкой (см. runAssembly, ruling про POST /edit-subtitles).
  it("сцена ЕСТЬ в scenesByOrder, но текст пуст/пробельный — субтитра тоже не даёт", () => {
    const segs = buildTrackSubtitleSegments({
      alignedScenes: SCENES,
      scenesByOrder: new Map([[1, { text: "   " }], [2, { text: "вторая сцена" }]]),
    })
    expect(segs).toHaveLength(1)
    expect(segs[0]!.text).toBe("вторая сцена")
  })
})
