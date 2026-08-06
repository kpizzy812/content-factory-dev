import { describe, expect, it } from "vitest"
import {
  estimateImageCost,
  estimateMediaCost,
  estimateTtsCost,
  estimateVideoCost,
  mapMediaInput,
  pickDuration,
  resolveMediaModel,
} from "../../../server/utils/media-provider/registry"

describe("media model registry", () => {
  it("uses Replicate Kling as the default lip-sync model", () => {
    const model = resolveMediaModel("lip_sync")

    expect(model.id).toBe("kwaivgi/kling-lip-sync")
    expect(model.provider).toBe("replicate")
    expect(model.capability).toBe("lip_sync")
  })

  it("maps normalized lip-sync input to Replicate fields", () => {
    const model = resolveMediaModel("lip_sync")

    expect(mapMediaInput(model, {
      videoUrl: "https://cdn.example.com/presenter.mp4",
      audioUrl: "https://cdn.example.com/speech.mp3",
    })).toEqual({
      video_url: "https://cdn.example.com/presenter.mp4",
      audio_file: "https://cdn.example.com/speech.mp3",
    })
  })

  it("estimates Kling lip-sync cost per output second", () => {
    const model = resolveMediaModel("lip_sync")

    expect(estimateMediaCost(model, 70)).toBeCloseTo(0.98, 8)
  })

  it("publishes the input restrictions used for source validation", () => {
    const model = resolveMediaModel("lip_sync")

    expect(model.constraints).toMatchObject({
      videoExtensions: ["mp4", "mov"],
      audioExtensions: ["mp3", "wav", "m4a", "aac"],
      minDurationSec: 2,
      maxDurationSec: 10,
      maxVideoBytes: 100 * 1024 * 1024,
      maxAudioBytes: 5 * 1024 * 1024,
    })
  })

  it("uses Replicate MiniMax as the default TTS model", () => {
    const model = resolveMediaModel("tts")

    expect(model.id).toBe("minimax/speech-02-turbo")
    expect(model.provider).toBe("replicate")
    expect(model.constraints.languages).toContain("ru")
  })

  it("maps Russian speech input to MiniMax fields", () => {
    const model = resolveMediaModel("tts")

    expect(mapMediaInput(model, {
      text: "Сахар входит в топ-три ингредиента",
      voiceId: "Wise_Woman",
      speed: 1,
      language: "ru",
    })).toEqual({
      text: "Сахар входит в топ-три ингредиента",
      voice_id: "Wise_Woman",
      speed: 1,
      language_boost: "Russian",
    })
  })

  it("keeps only emotions the model accepts", () => {
    const model = resolveMediaModel("tts")
    const base = { text: "Реплика", voiceId: "Wise_Woman", speed: 1, language: "ru" }

    // Сценарист пишет эмоцию свободным текстом — понятное переводим в enum...
    expect(mapMediaInput(model, { ...base, emotion: "лёгкая тревога" }))
      .toMatchObject({ emotion: "fearful" })
    expect(mapMediaInput(model, { ...base, emotion: "calm" }))
      .toMatchObject({ emotion: "calm" })
    expect(mapMediaInput(model, { ...base, emotion: "тёплая уверенность, приглашение" }))
      .toMatchObject({ emotion: "calm" })
    // ...а непонятое не угадываем: неизвестное значение уронило бы запрос.
    expect(mapMediaInput(model, { ...base, emotion: "любопытство" }))
      .not.toHaveProperty("emotion")
  })

  it("falls back to the language value the model actually accepts", () => {
    const model = resolveMediaModel("tts")

    expect(mapMediaInput(model, {
      text: "Line", voiceId: "Wise_Woman", speed: 1, language: "en",
    })).toMatchObject({ language_boost: "English" })
  })

  it("refuses languages the TTS model cannot pronounce", () => {
    const model = resolveMediaModel("tts")

    expect(() => mapMediaInput(model, {
      text: "こんにちは",
      voiceId: "Wise_Woman",
      speed: 1,
      language: "ja",
    })).toThrow('does not support language "ja"')
  })

  it("estimates TTS cost per 1000 characters", () => {
    const model = resolveMediaModel("tts")

    expect(estimateTtsCost(model, 500)).toBeCloseTo(model.priceUsdPer1kCharacters / 2, 8)
    expect(estimateTtsCost(model, 0)).toBe(0)
  })

  it("uses Replicate Kling as the default video model", () => {
    const model = resolveMediaModel("video")

    expect(model.id).toBe("kwaivgi/kling-v1.6-standard")
    expect(model.provider).toBe("replicate")
    expect(model.constraints.durationsSec).toEqual([5, 10])
  })

  it("asks the video model for a real vertical frame", () => {
    const model = resolveMediaModel("video")

    expect(mapMediaInput(model, {
      prompt: "nutritionist at a desk",
      format: "portrait",
      durationSec: 9,
    })).toMatchObject({ aspect_ratio: "9:16", duration: 10 })
  })

  it("rounds scene duration up to the grid the model accepts", () => {
    // Недостачу не восполнить, а лишнее подрежет монтаж.
    expect(pickDuration([5, 10], 4)).toBe(5)
    expect(pickDuration([5, 10], 5)).toBe(5)
    expect(pickDuration([5, 10], 6)).toBe(10)
    expect(pickDuration([5, 10], 99)).toBe(10)
  })

  it("passes a start image only when the model supports it", () => {
    const model = resolveMediaModel("video")

    expect(mapMediaInput(model, {
      prompt: "app screen", format: "portrait", durationSec: 5,
      startImageUrl: "https://cdn.example.com/screen.png",
    })).toMatchObject({ start_image: "https://cdn.example.com/screen.png" })
  })

  it("falls back to the narrowest vertical the image model knows", () => {
    const model = resolveMediaModel("image")

    // У flux-dev нет 9:16 — берём 2:3, обрезать дешевле, чем дорисовывать.
    expect(mapMediaInput(model, { prompt: "granola on a desk", format: "portrait" }))
      .toMatchObject({ aspect_ratio: "2:3", num_outputs: 1 })
  })

  it("estimates media cost per unit the provider bills", () => {
    expect(estimateImageCost(resolveMediaModel("image"), 3))
      .toBeCloseTo(resolveMediaModel("image").priceUsdPerImage * 3, 8)
    expect(estimateVideoCost(resolveMediaModel("video"), 10))
      .toBeCloseTo(resolveMediaModel("video").priceUsdPerOutputSecond * 10, 8)
  })

  it("rejects unsupported capabilities and model ids", () => {
    expect(() => resolveMediaModel("avatar_generation" as "lip_sync"))
      .toThrow("Unsupported media capability")
    expect(() => resolveMediaModel("lip_sync", "unknown/model"))
      .toThrow("Unsupported media model")
  })
})
