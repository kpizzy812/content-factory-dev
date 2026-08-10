import { describe, expect, it } from "vitest"
import {
  estimateMediaCost,
  mapMediaInput,
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

  // ─── text_to_speech: Replicate MiniMax ─────────────────────────

  it("uses Replicate MiniMax as the default TTS model", () => {
    const model = resolveMediaModel("text_to_speech")

    expect(model.id).toBe("minimax/speech-02-turbo")
    expect(model.provider).toBe("replicate")
    expect(model.execution).toBe("async_prediction")
    expect(model.constraints.languages).toContain("ru")
  })

  it("maps Russian speech input to MiniMax fields", () => {
    const model = resolveMediaModel("text_to_speech")

    expect(mapMediaInput(model, {
      text: "Сахар входит в топ-три ингредиента",
      voiceId: "Wise_Woman",
      speed: 1,
      language: "ru",
      format: "mp3",
    })).toEqual({
      text: "Сахар входит в топ-три ингредиента",
      voice_id: "Wise_Woman",
      speed: 1,
      language_boost: "Russian",
    })
  })

  it("keeps only emotions the model accepts", () => {
    const model = resolveMediaModel("text_to_speech")
    const base = { text: "Реплика", voiceId: "Wise_Woman", speed: 1, language: "ru", format: "mp3" }

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
    const model = resolveMediaModel("text_to_speech")

    expect(mapMediaInput(model, {
      text: "Line", voiceId: "Wise_Woman", speed: 1, language: "en", format: "mp3",
    })).toMatchObject({ language_boost: "English" })
  })

  it("refuses languages the TTS model cannot pronounce", () => {
    const model = resolveMediaModel("text_to_speech")

    expect(() => mapMediaInput(model, {
      text: "こんにちは",
      voiceId: "Wise_Woman",
      speed: 1,
      language: "ja",
      format: "mp3",
    })).toThrow('не произносит язык "ja"')
  })

  it("clamps pacing to the speed range MiniMax accepts", () => {
    const model = resolveMediaModel("text_to_speech")
    const base = { text: "Реплика", voiceId: "Wise_Woman", language: "ru", format: "mp3" }

    expect(mapMediaInput(model, { ...base, speed: 9 })).toMatchObject({ speed: 2 })
    expect(mapMediaInput(model, { ...base, speed: 0.1 })).toMatchObject({ speed: 0.5 })
  })

  it("refuses empty text instead of paying for silence", () => {
    const model = resolveMediaModel("text_to_speech")

    expect(() => mapMediaInput(model, {
      text: "   ", voiceId: "Wise_Woman", speed: 1, language: "ru", format: "mp3",
    })).toThrow("поле text обязательно")
  })

  it("estimates TTS cost per character", () => {
    const model = resolveMediaModel("text_to_speech")
    const billing = model.billing
    if (billing.unit !== "character") throw new Error("MiniMax тарифицируется за символ")

    expect(estimateMediaCost(model, { characters: 500 }))
      .toBeCloseTo(billing.usdPerCharacter * 500, 10)
    expect(estimateMediaCost(model, { characters: 0 })).toBe(0)
  })

  // ─── text_to_video: Replicate Kling 1.6 ────────────────────────

  it("uses Replicate Kling as the default clip model", () => {
    const model = resolveMediaModel("text_to_video")

    expect(model.id).toBe("kwaivgi/kling-v1.6-standard")
    expect(model.provider).toBe("replicate")
    expect(model.constraints.durationOptions).toEqual([5, 10])
  })

  it("rounds scene duration up to the grid the model accepts", () => {
    const model = resolveMediaModel("text_to_video")
    const base = { prompt: "nutritionist at a desk", aspectRatio: "9:16" as const, withAudio: false }
    const durationFor = (durationSec: number) =>
      mapMediaInput(model, { ...base, durationSec })

    // Недостачу не восполнить, а лишнее подрежет монтаж.
    expect(durationFor(4)).toMatchObject({ duration: 5 })
    expect(durationFor(5)).toMatchObject({ duration: 5 })
    expect(durationFor(6)).toMatchObject({ duration: 10 })
    expect(durationFor(99)).toMatchObject({ duration: 10 })
    // Фактическая длительность возвращается вызывающему: по ней считаются и
    // деньги, и таймлайн сборки.
    expect(model.mapInput({ ...base, durationSec: 4 }).effectiveDurationSec).toBe(5)
  })

  it("asks the clip model for a real vertical frame", () => {
    const model = resolveMediaModel("text_to_video")

    expect(mapMediaInput(model, {
      prompt: "nutritionist at a desk",
      durationSec: 9,
      aspectRatio: "9:16",
      withAudio: false,
    })).toMatchObject({ aspect_ratio: "9:16", duration: 10 })
  })

  it("estimates clip cost per output second, by the duration the model really shoots", () => {
    const model = resolveMediaModel("text_to_video")
    const billing = model.billing
    if (billing.unit !== "output_second") throw new Error("Kling тарифицируется за секунду выхода")

    // Платим за 10 снятых секунд, а не за 9 запрошенных.
    const { effectiveDurationSec } = model.mapInput({
      prompt: "scene", durationSec: 9, aspectRatio: "9:16", withAudio: false,
    })
    expect(estimateMediaCost(model, { outputSeconds: effectiveDurationSec! }))
      .toBeCloseTo(billing.usdPerSecond * 10, 10)
  })

  it("passes a start image only through the image-to-video spec", () => {
    const i2v = resolveMediaModel("image_to_video", "replicate:kling-v1.6-standard-i2v")

    expect(i2v.constraints.requiresImage).toBe(true)
    expect(mapMediaInput(i2v, {
      prompt: "app screen",
      imageUrl: "https://cdn.example.com/screen.png",
      durationSec: 5,
      aspectRatio: "9:16",
      withAudio: false,
    })).toMatchObject({ start_image: "https://cdn.example.com/screen.png", duration: 5 })
  })

  // ─── text_to_image: Replicate FLUX.1 dev ───────────────────────

  it("uses Replicate FLUX as the default image model", () => {
    const model = resolveMediaModel("text_to_image")

    expect(model.id).toBe("black-forest-labs/flux-dev")
    expect(model.provider).toBe("replicate")
  })

  it("falls back to the narrowest vertical the image model knows", () => {
    const model = resolveMediaModel("text_to_image")

    // У flux-dev нет 9:16 — берём 2:3, обрезать дешевле, чем дорисовывать.
    expect(mapMediaInput(model, {
      prompt: "granola on a desk", width: 1080, height: 1920, count: 1,
    })).toMatchObject({ aspect_ratio: "2:3", num_outputs: 1, output_format: "jpg" })
  })

  it("asks the image model for landscape when the frame is wider than tall", () => {
    const model = resolveMediaModel("text_to_image")

    expect(mapMediaInput(model, {
      prompt: "granola on a desk", width: 1920, height: 1080, count: 1,
    })).toMatchObject({ aspect_ratio: "16:9" })
  })

  it("estimates image cost per produced frame", () => {
    const model = resolveMediaModel("text_to_image")
    const billing = model.billing
    if (billing.unit !== "output_image") throw new Error("FLUX на Replicate тарифицируется за кадр")

    expect(estimateMediaCost(model, { images: 3 })).toBeCloseTo(billing.usdPerImage * 3, 10)
  })

  it("keeps the one-image-per-unit invariant instead of losing the rest silently", () => {
    const model = resolveMediaModel("text_to_image")

    expect(() => mapMediaInput(model, {
      prompt: "granola", width: 1080, height: 1920, count: 2,
    })).toThrow("разрешено 1")
  })

  // ─── Цены, которые нельзя пускать в смету без подтверждения ────

  it("marks Replicate prices as unconfirmed until a canary run", () => {
    // §6.1 спецификации: число из практики стенда — не подтверждённый тариф.
    // Флаг снимается только вместе с canary по docs/operations/replicate.md.
    expect(resolveMediaModel("text_to_image").billingConfirmed).toBe(false)
    expect(resolveMediaModel("text_to_video").billingConfirmed).toBe(false)
    expect(resolveMediaModel("text_to_speech").billingConfirmed).toBe(false)
    // Lip-sync обкатан и подтверждён.
    expect(resolveMediaModel("lip_sync").billingConfirmed).toBe(true)
  })

  it("rejects unsupported capabilities and model ids", () => {
    expect(() => resolveMediaModel("avatar_generation" as "lip_sync"))
      .toThrow("Unsupported media capability")
    expect(() => resolveMediaModel("lip_sync", "unknown/model"))
      .toThrow("Unsupported media model")
  })
})
