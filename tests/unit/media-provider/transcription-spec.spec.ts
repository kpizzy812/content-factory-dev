import { describe, expect, it } from "vitest"

import { estimateMediaCost, listMediaSpecs, mapMediaInput, resolveMediaRoute } from "~~/server/utils/media-provider/registry"

describe("способность transcription", () => {
  it("зарегистрирована в реестре", () => {
    const specs = listMediaSpecs("transcription")

    expect(specs.length).toBeGreaterThan(0)
    expect(specs[0]!.provider).toBe("replicate")
    expect(specs[0]!.execution).toBe("sync_json")
  })

  it("integrated=false осознанно (§4.1): цена уже подтверждена, но маршрут включается явной MEDIA_MODEL_TRANSCRIPTION", () => {
    const spec = listMediaSpecs("transcription")[0]!

    expect(spec.billingConfirmed).toBe(true)
    expect(spec.integrated).toBe(false)
  })

  it("несёт хеш версии Replicate — модель community, а не официальная (canary 26.08.2026: 404 на эндпоинте официальных моделей)", () => {
    const spec = listMediaSpecs("transcription")[0]!

    // Хеш подтверждён `https://replicate.com/api/models/openai/whisper/versions`
    // 26.08.2026 — это ПОСЛЕДНЯЯ из 13 версий модели (created_at 2024-11-26).
    // whisper-version-report.md фиксирует полную сверку.
    expect(spec.providerVersion).toBe("8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e")
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

  it("тарифицируется по времени GPU (hardware_second), а не по длине аудио", () => {
    // Правка тарифа (24.08.2026, §14): страница модели платит за время
    // выполнения на Nvidia T4 (~22с), а не за секунду аудио — старая
    // audio_second была неверной ЕДИНИЦЕЙ, а не только неверным числом.
    const spec = listMediaSpecs("transcription")[0]!
    const billing = spec.billing

    expect(billing.unit).toBe("hardware_second")
    if (billing.unit !== "hardware_second") throw new Error("unreachable")

    // Старая и новая единица дают РАЗНЫЕ числа на одном и том же аудио: цена
    // теперь вообще не зависит от audioSeconds — 10 минут стоят как 1 минута.
    const costFor10Min = estimateMediaCost(spec, { audioSeconds: 600 })
    const costFor1Min = estimateMediaCost(spec, { audioSeconds: 60 })
    expect(costFor10Min).toBe(costFor1Min)
    expect(costFor10Min).toBeCloseTo(billing.estimatedSeconds * billing.usdPerSecond, 10)

    // Факт (metrics.predict_time вебхука) переопределяет оценку из спеки.
    expect(estimateMediaCost(spec, { hardwareSeconds: 10 })).toBeCloseTo(10 * billing.usdPerSecond, 10)
  })
})
