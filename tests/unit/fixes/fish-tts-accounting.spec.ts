/**
 * Учёт синтеза у провайдера, который отдаёт байты.
 *
 * Два дефекта, найденные после первого живого ролика:
 *
 * 1. Смета TTS считалась только по символам и секундам. У Fish единица —
 *    UTF-8 байт, и `estimateMediaCost` на такой спеке ПАДАЛ с «единица
 *    utf8_byte требует usage.utf8Bytes». На бесплатной модели (`flat`, $0) это
 *    было незаметно, на платной уронило бы шаг озвучки целиком.
 *
 * 2. Вызов Fish не попадал в `MediaPrediction`: запись создавалась только при
 *    запрошенном `persist`, а TTS его не просит. У Replicate строку пишет
 *    prediction-service, у Fish писать некому — платный вызов был бы невидим
 *    в аудите и не переиспользовался бы при повторе.
 */

import { describe, expect, it, vi } from "vitest"
import { estimateMediaCost, findMediaSpec } from "~~/server/utils/media-provider/registry"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"
import { ttsUsageFor } from "~~/server/utils/media-provider/billing"

const RUSSIAN = "Замер бесплатный, но замерщик уедет с готовым расчётом."

describe("смета TTS знает обе единицы", () => {
  it("для платного Fish считает по байтам и не падает", () => {
    const fish = findMediaSpec("fish:s2.1-pro")!
    const usage = ttsUsageFor(RUSSIAN, 5.2)
    expect(usage.utf8Bytes).toBe(Buffer.byteLength(RUSSIAN, "utf8"))
    // Кириллица — два байта на букву, значит байт заметно больше символов.
    expect(usage.utf8Bytes!).toBeGreaterThan(usage.characters!)
    expect(() => estimateMediaCost(fish, usage)).not.toThrow()
  })

  it("для MiniMax по-прежнему считает по символам", () => {
    const minimax = findMediaSpec("replicate:minimax-speech-02-turbo")!
    const usage = ttsUsageFor(RUSSIAN, 5.2)
    expect(estimateMediaCost(minimax, usage))
      .toBeCloseTo(RUSSIAN.length * 0.06 / 1000, 8)
  })
})

describe("вызов Fish попадает в учёт", () => {
  it("prediction пишется даже без запрошенного persist", async () => {
    const saved: unknown[] = []
    const spec = findMediaSpec("fish:s2.1-pro-free")!

    await runMediaTask({
      capability: "text_to_speech",
      spec: spec as never,
      input: { text: RUSSIAN, voiceId: "voice-1", speed: 1, language: "ru", format: "mp3" },
      identityScope: "character:liana:line:7",
      unitKey: "scene:7",
      outputPath: "/tmp/line.mp3",
    }, {
      synthesizeBytes: async () => ({ bytes: Buffer.from("x"), contentType: "audio/mpeg" }),
      writeBytes: async () => {},
      findPersistedPrediction: async () => null,
      savePrediction: async (record) => { saved.push(record); return "pred_1" },
    })

    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ provider: "fish", capability: "text_to_speech" })
  })

  it("без ключа идемпотентности запись не выдумывается", async () => {
    const save = vi.fn()
    const spec = findMediaSpec("fish:s2.1-pro-free")!

    await runMediaTask({
      capability: "text_to_speech",
      spec: spec as never,
      input: { text: RUSSIAN, voiceId: "voice-1", speed: 1, language: "ru", format: "mp3" },
      unitKey: "scene:7",
      outputPath: "/tmp/line.mp3",
    }, {
      synthesizeBytes: async () => ({ bytes: Buffer.from("x"), contentType: "audio/mpeg" }),
      writeBytes: async () => {},
      savePrediction: save,
    })

    expect(save).not.toHaveBeenCalled()
  })
})
