/**
 * Мок транскрипции обязан быть ОСМЫСЛЕННЫМ, а не просто непустым.
 *
 * Прежняя заглушка («мок транскрипции», два слова на 1.2 с) доводила вызов до
 * конца, но выравнивание не узнавало ни одного слова сценария: границы всех
 * сцен схлопывались в начало трека, подгон клипов под трек отказывался
 * работать, и ролик собирался длиннее звука. Сквозной прогон Task 13 ловил это
 * как расхождение длины на 8.36 с.
 */

import { describe, expect, it } from "vitest"
import { buildMockTranscript } from "~~/server/utils/transcription/mock-transcript"

describe("buildMockTranscript", () => {
  it("отдаёт слова сценария, разложенные по всей длительности трека", () => {
    const payload = buildMockTranscript({
      scenes: [
        { order: 1, text: "первая сцена" },
        { order: 2, text: "вторая сцена тут" },
      ],
      audioSeconds: 10,
    })

    expect(payload.chunks.map(chunk => chunk.text)).toEqual([
      "первая", "сцена", "вторая", "сцена", "тут",
    ])
    expect(payload.text).toBe("первая сцена вторая сцена тут")
    // Первое слово начинается в нуле, последнее заканчивается на конце трека:
    // именно из этих границ выравнивание строит бакеты подгона.
    expect(payload.chunks[0]!.timestamp[0]).toBe(0)
    expect(payload.chunks.at(-1)!.timestamp[1]).toBe(10)
  })

  it("границы монотонны и не перекрываются", () => {
    const payload = buildMockTranscript({
      scenes: [{ order: 1, text: "раз два три четыре" }],
      audioSeconds: 3,
    })

    for (let index = 1; index < payload.chunks.length; index += 1) {
      expect(payload.chunks[index]!.timestamp[0]).toBeGreaterThanOrEqual(
        payload.chunks[index - 1]!.timestamp[1],
      )
    }
  })

  it("детерминирован: тот же вход — тот же выход", () => {
    const input = { scenes: [{ order: 1, text: "одно и то же" }], audioSeconds: 7 }

    expect(buildMockTranscript(input)).toEqual(buildMockTranscript(input))
  })

  it("пустой сценарий или неизмеренный трек не выдумывают слов", () => {
    expect(buildMockTranscript({ scenes: [], audioSeconds: 5 }).chunks).toEqual([])
    expect(buildMockTranscript({
      scenes: [{ order: 1, text: "есть текст" }],
      audioSeconds: 0,
    }).chunks).toEqual([])
  })
})
