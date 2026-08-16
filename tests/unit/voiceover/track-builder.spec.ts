import { describe, expect, it } from "vitest"

import { buildTrackRequest } from "~~/server/utils/voiceover/track-builder"

const scene = (order: number, text: string) => ({ order, text, source: "spoken" as const })

describe("сборка единого трека озвучки", () => {
  it("склеивает реплики сцен в один текст", () => {
    const request = buildTrackRequest([scene(1, "Первая реплика."), scene(2, "Вторая реплика.")])

    expect(request.text).toBe("Первая реплика. Вторая реплика.")
    expect(request.pauses).toEqual([])
  })

  it("вынимает маркер паузы из текста и запоминает её длину", () => {
    const request = buildTrackRequest([
      scene(1, "Смотри сюда. [пауза 2с]"),
      scene(2, "А теперь вывод."),
    ])

    // Маркер не должен попасть в синтез — модель прочитала бы его вслух.
    expect(request.text).toBe("Смотри сюда. А теперь вывод.")
    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 2 }])
  })

  it("отдаёт сцены с ОЧИЩЕННЫМ текстом для выравнивания", () => {
    const request = buildTrackRequest([scene(1, "Раз. [пауза 1.5с] Два.")])

    // В выравнивание должен уходить тот же текст, что ушёл в синтез: иначе
    // «пауза» и «1.5с» станут словами сценария, которых нет в транскрипте.
    expect(request.scenes).toEqual([{ order: 1, text: "Раз. Два." }])
    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 1.5 }])
  })

  it("падает, если текст не влезает в лимит модели", () => {
    expect(() => buildTrackRequest([scene(1, "а".repeat(120))], { maxCharacters: 100 }))
      .toThrow(/длиннее 100 символов/)
  })

  it("не отдаёт пустой запрос на синтез", () => {
    expect(() => buildTrackRequest([scene(1, "   ")])).toThrow(/пустой текст/)
  })
})
