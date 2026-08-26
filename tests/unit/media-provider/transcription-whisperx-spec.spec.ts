/**
 * Спека `replicate:whisperx` — замена `openai/whisper` для маршрута «монтаж
 * от звука»: у Whisper на Replicate нет поля пословных таймингов вообще (см.
 * докстринг `REPLICATE_WHISPER` в model-specs.ts и
 * `.superpowers/sdd/2026-08-24-shot-assembly/whisper-version-report.md`).
 *
 * Все факты ниже сверены НАПРЯМУЮ 26.08.2026, без доверия к чужому пересказу:
 *  - версия и цена — `https://replicate.com/api/models/victor-upmeet/whisperx/versions`
 *    (публичный эндпоинт, без токена) и страница модели
 *    `https://replicate.com/victor-upmeet/whisperx`;
 *  - схема входа — `_extras.dereferenced_openapi_schema` той же версии.
 */

import { describe, expect, it } from "vitest"

import { estimateMediaCost, findMediaSpec, listMediaSpecs, mapMediaInput } from "~~/server/utils/media-provider/registry"

function whisperxSpec() {
  const spec = findMediaSpec("replicate:whisperx")
  if (!spec || spec.capability !== "transcription") {
    throw new Error("спека replicate:whisperx не найдена в реестре transcription")
  }
  return spec
}

describe("спека replicate:whisperx", () => {
  it("зарегистрирована в реестре способности transcription рядом со старым Whisper", () => {
    const specs = listMediaSpecs("transcription")
    expect(specs.some(spec => spec.registryKey === "replicate:whisperx")).toBe(true)
    // Старую спеку не удаляли — это знание добыто дорого (canary 26.08.2026).
    expect(specs.some(spec => spec.registryKey === "replicate:whisper")).toBe(true)
  })

  it("несёт ПОСЛЕДНЮЮ версию модели (сверено 26.08.2026 напрямую с публичного эндпоинта versions)", () => {
    const spec = whisperxSpec()

    expect(spec.id).toBe("victor-upmeet/whisperx")
    expect(spec.provider).toBe("replicate")
    expect(spec.execution).toBe("sync_json")
    expect(spec.providerVersion).toBe("655845d6190ef70573c669245f245892cd039df4b880a1e3a65852c09252f5cc")
  })

  it("integrated=false осознанно — маршрут включается явной MEDIA_MODEL_TRANSCRIPTION (§4.1)", () => {
    const spec = whisperxSpec()

    expect(spec.billingConfirmed).toBe(true)
    expect(spec.integrated).toBe(false)
  })

  it("mapInput шлёт audio_file и align_output: true — НЕ audio/word_timestamps старой спеки", () => {
    const spec = whisperxSpec()

    const payload = mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
      language: "ru",
    })

    expect(payload).toEqual({
      audio_file: "https://cdn.example.com/voiceover.mp3",
      language: "ru",
      align_output: true,
    })
    expect(payload).not.toHaveProperty("audio")
    expect(payload).not.toHaveProperty("word_timestamps")
  })

  it("язык без подсказки уходит как ru по умолчанию, как и у прежней спеки", () => {
    const spec = whisperxSpec()

    const payload = mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
    })

    expect(payload).toMatchObject({ language: "ru" })
  })

  it("отказывает на языке за пределами продуктового набора", () => {
    const spec = whisperxSpec()

    expect(() => mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
      language: "zh",
    })).toThrow(/не размечает язык/)
  })

  it("тарифицируется по времени GPU (hardware_second) — сходится с ценой страницы модели ($0.018)", () => {
    const spec = whisperxSpec()
    const billing = spec.billing

    expect(billing.unit).toBe("hardware_second")
    if (billing.unit !== "hardware_second") throw new Error("unreachable")

    // Страница модели: "approximately $0.018 to run", GPU A100 (80GB),
    // "Predictions typically complete within 13 seconds".
    expect(billing.usdPerSecond).toBeCloseTo(0.0014, 10)
    expect(billing.estimatedSeconds).toBe(13)

    const cost = estimateMediaCost(spec, { audioSeconds: 42 })
    expect(cost).toBeCloseTo(0.018, 2)
    // Как и у Whisper, цена не зависит от длины аудио — только от факта/оценки GPU-времени.
    expect(estimateMediaCost(spec, { audioSeconds: 600 })).toBe(cost)
  })
})
