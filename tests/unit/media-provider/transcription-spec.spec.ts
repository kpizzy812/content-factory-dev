import { describe, expect, it } from "vitest"

import { estimateMediaCost, listMediaSpecs, mapMediaInput, resolveMediaRoute } from "~~/server/utils/media-provider/registry"

describe("способность transcription", () => {
  it("зарегистрирована в реестре", () => {
    const specs = listMediaSpecs("transcription")

    expect(specs.length).toBeGreaterThan(0)
    expect(specs[0]!.provider).toBe("replicate")
    expect(specs[0]!.execution).toBe("sync_json")
  })

  it("не включена, пока цена не подтверждена страницей модели", () => {
    const spec = listMediaSpecs("transcription")[0]!

    expect(spec.billingConfirmed).toBe(false)
    expect(spec.integrated).toBe(false)
  })

  it("маршрут отказывает внятно, пока нет ни одной integrated модели", () => {
    expect(() => resolveMediaRoute("transcription", null, {}))
      .toThrow(/No integrated media model registered for transcription/)
  })

  it("собирает payload из нормализованного входа", () => {
    const spec = listMediaSpecs("transcription")[0]!

    expect(mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
      language: "ru",
    })).toMatchObject({
      audio: "https://cdn.example.com/voiceover.mp3",
      language: "ru",
    })
  })

  it("отказывает на языке, которого модель не размечает", () => {
    const spec = listMediaSpecs("transcription")[0]!

    expect(() => mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
      language: "zh",
    })).toThrow(/не размечает язык/)
  })

  it("считает цену по секундам аудио", () => {
    const spec = listMediaSpecs("transcription")[0]!
    const billing = spec.billing

    expect(billing.unit).toBe("audio_second")
    if (billing.unit !== "audio_second") throw new Error("unreachable")

    // Не сверяем литерал сам с собой: реально считаем цену через estimateMediaCost
    // и проверяем, что она равна ставке спеки, умноженной на секунды аудио.
    expect(estimateMediaCost(spec, { audioSeconds: 120 })).toBeCloseTo(120 * billing.usdPerSecond, 10)
    expect(estimateMediaCost(spec, { audioSeconds: 0 })).toBe(0)
  })
})
