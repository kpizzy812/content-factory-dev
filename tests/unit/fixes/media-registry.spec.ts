/**
 * Реестр медиамоделей: маршрут способности, мапперы входа, разбор выхода,
 * биллинг и витрина. Раздел 5.1 спецификации
 * docs/superpowers/specs/2026-08-07-replicate-media-contour.md.
 *
 * Тесты без БД и без сети: спеки — это данные, всё считается на месте.
 */

import { describe, expect, it } from "vitest"
import {
  estimateMediaCost,
  findMediaSpec,
  listMediaSpecs,
  MEDIA_CAPABILITIES,
  mapMediaInput,
  requireSingleOutputUrl,
  resolveMediaModel,
  resolveMediaRoute,
  resolveSpecVoice,
} from "../../../server/utils/media-provider/registry"
import type { MediaModelSpec } from "../../../server/utils/media-provider/types"
import {
  IMAGE_MODELS,
  LIP_SYNC_MODELS,
  TTS_MODELS,
  VIDEO_MODELS,
  getDefaultImageModel,
  getDefaultLipSyncModel,
  getDefaultTtsModel,
  getDefaultVideoModel,
  getModel,
  getModelsByTask,
  pickTtsModel,
  recommendModels,
} from "../../../server/utils/video-models"

/** Пустое окружение: тесты не должны зависеть от env разработчика. */
const EMPTY_ENV: Record<string, string | undefined> = {}

function specFor(reference: string): MediaModelSpec {
  const spec = findMediaSpec(reference)
  if (!spec) throw new Error(`Спека не найдена: ${reference}`)
  return spec
}

describe("resolveMediaRoute — выбор маршрута способности", () => {
  it("берёт первую integrated модель, когда нет ни запроса, ни env-дефолта", () => {
    // PROJECT_CONTEXT §5: Replicate — основной провайдер медиа, поэтому его
    // спека стоит первой в каждой способности, где она подключена.
    expect(resolveMediaRoute("text_to_image", null, EMPTY_ENV).primary.id).toBe("black-forest-labs/flux-dev")
    expect(resolveMediaRoute("text_to_video", null, EMPTY_ENV).primary.id)
      .toBe("kwaivgi/kling-v1.6-standard")
    expect(resolveMediaRoute("text_to_speech", null, EMPTY_ENV).primary.id)
      .toBe("minimax/speech-02-turbo")
    expect(resolveMediaRoute("lip_sync", null, EMPTY_ENV).primary.id).toBe("kwaivgi/kling-lip-sync")
    expect(resolveMediaRoute("image_to_video", null, EMPTY_ENV).primary.id)
      .toBe("kwaivgi/kling-v1.6-standard")
  })

  it("image_to_video: fal остаётся резервом, а не основным маршрутом", () => {
    // AGENTS.md: fal допускается только как явно настроенный fallback. Пустой
    // MEDIA_PROVIDER_FALLBACK означает «увидеть настоящую ошибку Replicate».
    const withoutFallback = resolveMediaRoute("image_to_video", null, EMPTY_ENV)
    expect(withoutFallback.primary.provider).toBe("replicate")
    expect(withoutFallback.fallback).toBeNull()

    const withFallback = resolveMediaRoute("image_to_video", null, {
      MEDIA_PROVIDER_FALLBACK: "fal",
    })
    expect(withFallback.fallback?.id).toBe("fal-ai/kling-video/v2.1/standard/image-to-video")
  })

  it("явный запрос выигрывает у env-дефолта и принимается в трёх формах записи", () => {
    const env = { MEDIA_MODEL_TEXT_TO_IMAGE: "fal-ai/flux/schnell" }
    expect(resolveMediaRoute("text_to_image", "fal:flux-dev", env).primary.id).toBe("fal-ai/flux/dev")
    expect(resolveMediaRoute("text_to_image", "fal:fal-ai/flux/dev", env).primary.id).toBe("fal-ai/flux/dev")
    expect(resolveMediaRoute("text_to_image", "fal-ai/flux/dev", env).primary.id).toBe("fal-ai/flux/dev")
  })

  it("env-дефолт способности выигрывает у порядка реестра", () => {
    const route = resolveMediaRoute("text_to_video", null, {
      MEDIA_MODEL_TEXT_TO_VIDEO: "fal-ai/wan/v2.2-a14b/text-to-video",
    })
    expect(route.primary.id).toBe("fal-ai/wan/v2.2-a14b/text-to-video")
  })

  it("для lip-sync поддержан прежний REPLICATE_DEFAULT_LIPSYNC_MODEL", () => {
    const route = resolveMediaRoute("lip_sync", null, {
      REPLICATE_DEFAULT_LIPSYNC_MODEL: "fal-ai/sync-lipsync",
    })
    expect(route.primary.id).toBe("fal-ai/sync-lipsync")
    expect(route.primary.provider).toBe("fal")
  })

  it("без MEDIA_PROVIDER_FALLBACK резерва нет — видна настоящая ошибка провайдера", () => {
    expect(resolveMediaRoute("lip_sync", null, EMPTY_ENV).fallback).toBeNull()
  })

  it("MEDIA_PROVIDER_FALLBACK=fal даёт конкретную спеку резерва со своей ценой", () => {
    const route = resolveMediaRoute("lip_sync", null, { MEDIA_PROVIDER_FALLBACK: "fal" })
    expect(route.primary.id).toBe("kwaivgi/kling-lip-sync")
    expect(route.fallback?.id).toBe("fal-ai/sync-lipsync")
    expect(route.fallback?.provider).toBe("fal")
    // Резерв считает деньги по СВОЕЙ цене, а не по цене основного маршрута.
    expect(estimateMediaCost(route.fallback!, { outputSeconds: 10 })).toBeCloseTo(0.67, 8)
    expect(estimateMediaCost(route.primary, { outputSeconds: 10 })).toBeCloseTo(0.14, 8)
  })

  it("по-способностный override перекрывает общий резерв", () => {
    const env = {
      MEDIA_PROVIDER_FALLBACK: "fal",
      MEDIA_PROVIDER_FALLBACK_TEXT_TO_IMAGE: "replicate",
    }
    // Спек Replicate под изображения ещё нет — честный null вместо слепого сабмита.
    expect(resolveMediaRoute("text_to_image", null, env).fallback).toBeNull()
    // А для lip-sync общий резерв продолжает работать.
    expect(resolveMediaRoute("lip_sync", null, env).fallback?.id).toBe("fal-ai/sync-lipsync")
  })

  it("нет спеки способности у провайдера-резерва → fallback null, а не чужая модель", () => {
    const route = resolveMediaRoute("text_to_video", null, { MEDIA_PROVIDER_FALLBACK: "replicate" })
    expect(route.fallback).toBeNull()
  })

  it("неизвестная способность и неизвестная модель падают внятно", () => {
    expect(() => resolveMediaRoute("avatar_generation" as "lip_sync", null, EMPTY_ENV))
      .toThrow("Unsupported media capability")
    expect(() => resolveMediaRoute("lip_sync", "unknown/model", EMPTY_ENV))
      .toThrow("Unsupported media model")
    // Модель другой способности не подходит к запрошенной.
    expect(() => resolveMediaRoute("text_to_video", "fal-ai/flux/dev", EMPTY_ENV))
      .toThrow("Unsupported media model")
  })

  it("неверное значение MEDIA_PROVIDER_FALLBACK — ошибка конфигурации", () => {
    expect(() => resolveMediaRoute("lip_sync", null, { MEDIA_PROVIDER_FALLBACK: "midjourney" }))
      .toThrow("MEDIA_PROVIDER_FALLBACK")
  })
})

describe("мапперы входа", () => {
  it("FLUX получает прежний payload шага генерации изображений", () => {
    const spec = specFor("fal-ai/flux/schnell")
    expect(spec.mapInput({
      prompt: "кофейня на закате",
      width: 1080,
      height: 1920,
      count: 1,
    })).toEqual({
      payload: {
        prompt: "кофейня на закате",
        image_size: { width: 1080, height: 1920 },
        num_images: 1,
      },
    })
  })

  it("FLUX не даёт просить больше одного изображения — иначе выход теряется молча", () => {
    const spec = specFor("fal-ai/flux/dev")
    expect(() => spec.mapInput({ prompt: "кадр", width: 1080, height: 1920, count: 2 }))
      .toThrow("разрешено 1")
  })

  it("Kling text-to-video: длительность строкой, аудио флагом, квантования нет", () => {
    const spec = specFor("fal-ai/kling-video/v3/standard/text-to-video")
    expect(spec.mapInput({
      prompt: "герой открывает приложение",
      durationSec: 6,
      aspectRatio: "9:16",
      withAudio: true,
      negativePrompt: "blurry",
    })).toEqual({
      payload: {
        prompt: "герой открывает приложение",
        duration: "6",
        aspect_ratio: "9:16",
        generate_audio: true,
        negative_prompt: "blurry",
      },
      effectiveDurationSec: 6,
    })
  })

  it("Wan считает кадрами и возвращает фактическую длительность после квантования", () => {
    const spec = specFor("fal-ai/wan/v2.2-a14b/text-to-video")
    const mapped = spec.mapInput({
      prompt: "город сверху",
      durationSec: 6.4,
      aspectRatio: "9:16",
      withAudio: true,
      negativePrompt: "text",
    })
    expect(mapped.payload).toEqual({
      prompt: "город сверху",
      num_frames: 102,
      frames_per_second: 16,
      aspect_ratio: "9:16",
      negative_prompt: "text",
      resolution: "720p",
    })
    // 102 / 16 = 6.375 — по этому числу платим, а не по запрошенным 6.4.
    expect(mapped.effectiveDurationSec).toBeCloseTo(6.375, 8)
    // Границы кадров Wan: 17..161.
    expect(spec.mapInput({ prompt: "p", durationSec: 0.5, aspectRatio: "9:16", withAudio: false }).payload)
      .toMatchObject({ num_frames: 17 })
    expect(spec.mapInput({ prompt: "p", durationSec: 30, aspectRatio: "9:16", withAudio: false }).payload)
      .toMatchObject({ num_frames: 161 })
  })

  it("Hailuo квантует длительность в 5 или 10", () => {
    const spec = specFor("fal-ai/minimax/hailuo-02/standard/text-to-video")
    expect(spec.mapInput({ prompt: "p", durationSec: 6, aspectRatio: "9:16", withAudio: false }))
      .toEqual({ payload: { prompt: "p", duration: 5, prompt_optimizer: true }, effectiveDurationSec: 5 })
    expect(spec.mapInput({ prompt: "p", durationSec: 7, aspectRatio: "9:16", withAudio: false }))
      .toEqual({ payload: { prompt: "p", duration: 10, prompt_optimizer: true }, effectiveDurationSec: 10 })
  })

  it("image-to-video: payload шага сохранён, длительность только 5 или 10", () => {
    const spec = specFor("fal-ai/kling-video/v2.1/standard/image-to-video")
    if (spec.capability !== "image_to_video") throw new Error("ожидалась спека image_to_video")

    expect(spec.mapInput({
      prompt: "интерфейс приложения оживает",
      imageUrl: "https://fal.media/screen.png",
      durationSec: 8,
      aspectRatio: "9:16",
      withAudio: false,
      negativePrompt: "blurry",
    })).toEqual({
      payload: {
        prompt: "интерфейс приложения оживает",
        image_url: "https://fal.media/screen.png",
        duration: "10",
        aspect_ratio: "9:16",
        negative_prompt: "blurry",
      },
      effectiveDurationSec: 10,
    })

    expect(spec.mapInput({
      prompt: "p",
      imageUrl: "https://fal.media/screen.png",
      durationSec: 5,
      aspectRatio: "9:16",
      withAudio: false,
    }).effectiveDurationSec).toBe(5)
  })

  it("TTS-мапперы совпадают с прежним сборщиком payload в tts.ts", () => {
    const kokoro = specFor("fal-ai/kokoro/russian")
    expect(kokoro.mapInput({ text: "привет", voiceId: "bf_emma", speed: 1, language: "ru", format: "mp3" }))
      .toEqual({ payload: { prompt: "привет", voice: "bf_emma", speed: 1 } })

    const playai = specFor("fal-ai/playai/tts/v3")
    expect(playai.mapInput({ text: "hi", voiceId: "s3://voice", speed: 0.85, language: "en", format: "mp3" }))
      .toEqual({ payload: { input: "hi", voice: "s3://voice", response_format: "mp3", speed: 0.85 } })

    const eleven = specFor("fal-ai/elevenlabs/tts/turbo-v2.5")
    expect(eleven.mapInput({ text: "hi", voiceId: "Rachel", speed: 1.15, language: "en", format: "mp3" }))
      .toEqual({ payload: { text: "hi", voice: "Rachel", stability: 0.5, similarity_boost: 0.75 } })
  })

  it("lip-sync payload не изменился: video_url + audio_file", () => {
    const spec = resolveMediaModel("lip_sync")
    expect(mapMediaInput(spec, {
      videoUrl: "https://cdn.example.com/presenter.mp4",
      audioUrl: "https://cdn.example.com/speech.mp3",
    })).toEqual({
      video_url: "https://cdn.example.com/presenter.mp4",
      audio_file: "https://cdn.example.com/speech.mp3",
    })
  })

  it("пустые обязательные поля входа падают, а не уезжают в сабмит", () => {
    const kling = specFor("fal-ai/kling-video/v3/standard/text-to-video")
    expect(() => kling.mapInput({ prompt: "  ", durationSec: 5, aspectRatio: "9:16", withAudio: false }))
      .toThrow("prompt")
    expect(() => kling.mapInput({ prompt: "p", durationSec: 0, aspectRatio: "9:16", withAudio: false }))
      .toThrow("durationSec")
  })

  it("незнакомая модель НЕ получает Kling-payload по умолчанию — её просто нет в реестре", () => {
    expect(findMediaSpec("fal-ai/kling-video/v9/experimental/text-to-video")).toBeUndefined()
    expect(() => resolveMediaRoute("text_to_video", "fal-ai/kling-video/v9/experimental/text-to-video", EMPTY_ENV))
      .toThrow("Unsupported media model")
  })

  it("голоса по умолчанию берутся из спеки, env-override сохранён", () => {
    expect(resolveSpecVoice(specFor("fal-ai/kokoro/american-english"), "en", EMPTY_ENV)).toBe("af_heart")
    expect(resolveSpecVoice(specFor("fal-ai/kokoro/russian"), "ru", EMPTY_ENV)).toBe("bf_emma")
    expect(resolveSpecVoice(specFor("fal-ai/kokoro/american-english"), "en", { DEFAULT_TTS_VOICE_EN: "am_adam" }))
      .toBe("am_adam")
    expect(resolveSpecVoice(specFor("fal-ai/playai/tts/v3"), "ru-RU", EMPTY_ENV))
      .toContain("baf1ef41")
    expect(resolveSpecVoice(specFor("fal-ai/playai/tts/v3"), "en", EMPTY_ENV))
      .toContain("820da3f2")
    expect(resolveSpecVoice(specFor("fal-ai/flux/dev"), "en", EMPTY_ENV)).toBeNull()
  })
})

describe("extractOutput — разбор ответа провайдера", () => {
  const image = specFor("fal-ai/flux/schnell")
  const video = specFor("fal-ai/kling-video/v3/standard/text-to-video")
  const audio = specFor("fal-ai/kokoro/russian")

  it("понимает формы, которые реально возвращают провайдеры", () => {
    expect(image.extractOutput({ images: [{ url: "https://cdn/i.png", content_type: "image/png" }] }))
      .toEqual({ urls: ["https://cdn/i.png"], contentType: "image/png" })
    expect(video.extractOutput({ video: { url: "https://cdn/v.mp4" } }))
      .toEqual({ urls: ["https://cdn/v.mp4"], contentType: "video/mp4" })
    expect(audio.extractOutput({ audio: { url: "https://cdn/a.mp3" } }))
      .toEqual({ urls: ["https://cdn/a.mp3"], contentType: "audio/mpeg" })
    expect(audio.extractOutput({ audio_url: "https://cdn/a.mp3" }).urls).toEqual(["https://cdn/a.mp3"])
    expect(audio.extractOutput({ output: { audio: { url: "https://cdn/a.mp3" } } }).urls)
      .toEqual(["https://cdn/a.mp3"])
    expect(video.extractOutput("https://cdn/v.mp4").urls).toEqual(["https://cdn/v.mp4"])
    expect(video.extractOutput(["https://cdn/v.mp4"]).urls).toEqual(["https://cdn/v.mp4"])
    expect(video.extractOutput({ url: "https://cdn/v.mp4" }).urls).toEqual(["https://cdn/v.mp4"])
  })

  it("множественный выход не теряется молча", () => {
    const output = image.extractOutput({ images: [{ url: "https://cdn/1.png" }, { url: "https://cdn/2.png" }] })
    expect(output.urls).toEqual(["https://cdn/1.png", "https://cdn/2.png"])
    expect(() => requireSingleOutputUrl(output, "сцена scene_1")).toThrow("контракт — один результат")
  })

  it("пустой выход — ошибка, а не пустая строка", () => {
    expect(image.extractOutput({}).urls).toEqual([])
    expect(() => requireSingleOutputUrl(image.extractOutput({}), "сцена scene_1"))
      .toThrow("не вернул ни одного URL")
  })
})

describe("estimateMediaCost — все единицы биллинга", () => {
  const base = specFor("fal-ai/flux/schnell")
  const withBilling = (billing: MediaModelSpec["billing"]): MediaModelSpec =>
    ({ ...base, billing } as MediaModelSpec)

  it("output_megapixel, output_second, audio_second, character — по реальным спекам", () => {
    expect(estimateMediaCost(specFor("fal-ai/flux/schnell"), { megapixels: 2 })).toBeCloseTo(0.006, 8)
    expect(estimateMediaCost(specFor("fal-ai/flux/dev"), { megapixels: 2 })).toBeCloseTo(0.05, 8)
    expect(estimateMediaCost(specFor("fal-ai/kokoro/russian"), { audioSeconds: 40 })).toBeCloseTo(0.01, 8)
    expect(estimateMediaCost(specFor("fal-ai/playai/tts/v3"), { characters: 1000 })).toBeCloseTo(0.03, 8)
    expect(estimateMediaCost(specFor("fal-ai/elevenlabs/tts/turbo-v2.5"), { characters: 1000 }))
      .toBeCloseTo(0.15, 8)
  })

  it("output_second учитывает встроенное аудио и цену по разрешению", () => {
    const kling = specFor("fal-ai/kling-video/v3/standard/text-to-video")
    expect(estimateMediaCost(kling, { outputSeconds: 5 })).toBeCloseTo(0.42, 8)
    expect(estimateMediaCost(kling, { outputSeconds: 5, withAudio: true })).toBeCloseTo(0.63, 8)

    const wan = specFor("fal-ai/wan/v2.2-a14b/text-to-video")
    expect(estimateMediaCost(wan, { outputSeconds: 5 })).toBeCloseTo(0.4, 8)
    expect(estimateMediaCost(wan, { outputSeconds: 5, resolution: "480p" })).toBeCloseTo(0.2, 8)
    // У Wan нет встроенного аудио — флаг не должен добавлять надбавку.
    expect(estimateMediaCost(wan, { outputSeconds: 5, withAudio: true })).toBeCloseTo(0.4, 8)
  })

  it("output_image, hardware_second и flat считаются по своим правилам", () => {
    expect(estimateMediaCost(withBilling({ unit: "output_image", usdPerImage: 0.04 }), { images: 3 }))
      .toBeCloseTo(0.12, 8)

    const hardware = withBilling({ unit: "hardware_second", usdPerSecond: 0.001, estimatedSeconds: 30 })
    // Смета — по оценке из спеки, факт — по metrics.predict_time из вебхука.
    expect(estimateMediaCost(hardware, {})).toBeCloseTo(0.03, 8)
    expect(estimateMediaCost(hardware, { hardwareSeconds: 12 })).toBeCloseTo(0.012, 8)

    expect(estimateMediaCost(withBilling({ unit: "flat", usd: 0.25 }), {})).toBeCloseTo(0.25, 8)
  })

  it("короткая форма числом означает секунды выхода (совместимость с lip-sync)", () => {
    expect(estimateMediaCost(resolveMediaModel("lip_sync"), 70)).toBeCloseTo(0.98, 8)
    expect(estimateMediaCost(resolveMediaModel("lip_sync"), { outputSeconds: 70 })).toBeCloseTo(0.98, 8)
  })

  it("отсутствие нужной единицы потребления — ошибка, а не ноль", () => {
    expect(() => estimateMediaCost(specFor("fal-ai/playai/tts/v3"), {})).toThrow("characters")
    expect(() => estimateMediaCost(specFor("fal-ai/flux/dev"), {})).toThrow("megapixels")
    expect(() => estimateMediaCost(specFor("fal-ai/flux/dev"), { megapixels: -1 })).toThrow("неотрицательным")
  })

  it("смета шага равна сумме фактов при совпадении входов", () => {
    const kling = specFor("fal-ai/kling-video/v3/standard/text-to-video")
    const scenes = [4, 6, 5]
    const estimate = estimateMediaCost(kling, { outputSeconds: scenes.reduce((s, n) => s + n, 0) })
    const facts = scenes.reduce((sum, sec) => sum + estimateMediaCost(kling, { outputSeconds: sec }), 0)
    expect(facts).toBeCloseTo(estimate, 8)
  })
})

describe("контракт реестра", () => {
  it("registryKey уникален глобально, id — в пределах способности", () => {
    const specs = listMediaSpecs()
    expect(new Set(specs.map(s => s.registryKey)).size).toBe(specs.length)

    // Голый id провайдера уникален не глобально, а внутри способности: одна
    // модель может уметь две (Kling 1.6 на Replicate — t2v и i2v). Именно
    // поэтому ключ реестра — registryKey, а не id.
    for (const capability of MEDIA_CAPABILITIES) {
      const ids = listMediaSpecs(capability).map(s => s.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it("одна модель под двумя способностями находится по голому id для каждой из них", () => {
    // В Video.videoModelId лежит именно голый id, и он обязан привести к t2v-спеке,
    // а не к i2v только потому, что та объявлена ниже в реестре.
    expect(resolveMediaModel("text_to_video", "kwaivgi/kling-v1.6-standard").registryKey)
      .toBe("replicate:kling-v1.6-standard-t2v")
    expect(resolveMediaModel("image_to_video", "kwaivgi/kling-v1.6-standard").registryKey)
      .toBe("replicate:kling-v1.6-standard-i2v")
  })

  it("модель исполнения определяется спекой, а не подстрокой в id", () => {
    expect(resolveMediaModel("lip_sync").execution).toBe("async_prediction")
    expect(specFor("fal-ai/flux/dev").execution).toBe("sync_queue")
    expect(specFor("fal-ai/sync-lipsync").execution).toBe("sync_queue")
  })

  it("таймаут клипов не меньше 30 минут, у i2v — больше", () => {
    expect(specFor("fal-ai/kling-video/v3/standard/text-to-video").timeoutMs).toBeGreaterThanOrEqual(30 * 60_000)
    expect(specFor("fal-ai/kling-video/v2.1/standard/image-to-video").timeoutMs)
      .toBeGreaterThan(specFor("fal-ai/kling-video/v3/standard/text-to-video").timeoutMs)
  })

  it("неподтверждённая цена помечена явно — в деньги такую модель пускать нельзя", () => {
    // Тариф fal за секунду Kling v2.1 i2v в проекте не зафиксирован (§7 п.1).
    expect(specFor("fal-ai/kling-video/v2.1/standard/image-to-video").billingConfirmed).toBe(false)
    // Подтверждено = тариф прочитан со страницы модели (`billingConfig`);
    // публичный API цены не отдаёт вовсе, а HTML страницы отдаёт без токена.
    // Снято 14.08.2026. minimax speech-02-turbo подтверждён иначе — счётом:
    // token_input_count оплаченных прогонов совпал с длиной русского текста.
    const CONFIRMED_BY_MODEL_PAGE = new Set([
      "prunaai/p-video-avatar",
      // Аватарные модели сверены со страницами 16.08.2026: три из четырёх
      // занижали смету втрое (omni-human $0.045→$0.14, fabric $0.025→$0.08),
      // а wan-2.2-s2v вообще считался за время GPU вместо секунд выхода.
      "bytedance/omni-human",
      "veed/fabric-1.0",
      "wan-video/wan-2.2-s2v",
      "kwaivgi/kling-avatar-v2",
      "black-forest-labs/flux-kontext-dev",
      "black-forest-labs/flux-kontext-pro",
      "black-forest-labs/flux-kontext-max",
      "black-forest-labs/flux-dev",
      "kwaivgi/kling-v1.6-standard",
      "minimax/speech-02-turbo",
    ])
    for (const spec of listMediaSpecs()) {
      if (spec.provider !== "replicate") continue
      if (spec.capability === "lip_sync") continue
      expect(spec.billingConfirmed).toBe(CONFIRMED_BY_MODEL_PAGE.has(spec.id))
    }
    // Тарифы fal подтверждены страницами моделей, lip-sync — обкатан.
    for (const spec of listMediaSpecs("text_to_image")) {
      if (spec.provider === "fal") expect(spec.billingConfirmed).toBe(true)
    }
    for (const spec of listMediaSpecs("lip_sync")) expect(spec.billingConfirmed).toBe(true)
  })

  it("Replicate закрывает все восемь способностей, fal остаётся резервом", () => {
    const replicate = listMediaSpecs().filter(spec => spec.provider === "replicate")
    expect([...new Set(replicate.map(spec => spec.capability))].sort()).toEqual([
      "image_to_image",
      "image_to_video",
      "lip_sync",
      "speech_to_video",
      "text_to_image",
      "text_to_speech",
      "text_to_video",
      "transcription",
    ])
    // У каждой способности первым подключённым идёт Replicate.
    const capabilities = [
      "text_to_image",
      "text_to_video",
      "image_to_video",
      "text_to_speech",
      "lip_sync",
      "speech_to_video",
      "image_to_image",
    ] as const
    for (const capability of capabilities) {
      expect(listMediaSpecs(capability).find(spec => spec.integrated)?.provider).toBe("replicate")
    }
    // speech_to_video — способность, которой у fal нет вовсе: аватарная сцена
    // не имеет резервного маршрута, и это осознанно (см. §3.2 спецификации).
    expect(listMediaSpecs("speech_to_video").every(spec => spec.provider === "replicate")).toBe(true)
  })
})

describe("витрина video-models собирается из спек", () => {
  it("состав и порядок: Replicate первым, прежние fal-модели следом", () => {
    expect(IMAGE_MODELS.map(m => m.id)).toEqual([
      "black-forest-labs/flux-dev",
      "fal-ai/flux/schnell",
      "fal-ai/flux/dev",
    ])
    expect(VIDEO_MODELS.map(m => m.id)).toEqual([
      "kwaivgi/kling-v1.6-standard",
      "fal-ai/kling-video/v3/standard/text-to-video",
      "fal-ai/kling-video/v3/pro/text-to-video",
      "fal-ai/wan/v2.2-a14b/text-to-video",
      "fal-ai/minimax/hailuo-02/standard/text-to-video",
    ])
    // Fish идёт последним: маршрут по умолчанию остаётся на Replicate
    // (PROJECT_CONTEXT §5), а Fish включается персонажу через
    // Character.voiceModelId, а не подменой дефолта у всех роликов разом.
    expect(TTS_MODELS.map(m => m.id)).toEqual([
      "minimax/speech-02-turbo",
      "fal-ai/kokoro/american-english",
      "fal-ai/kokoro/russian",
      "fal-ai/playai/tts/v3",
      "fal-ai/elevenlabs/tts/turbo-v2.5",
      "s2.1-pro-free",
      "s2.1-pro",
    ])
    // Sync Labs добавлены как премиальная альтернатива Kling: тот же вход
    // (готовое видео + аудио), заметно точнее на фронтальной съёмке.
    expect(LIP_SYNC_MODELS.map(m => m.id)).toEqual([
      "kwaivgi/kling-lip-sync",
      "sync/lipsync-2",
      "sync/lipsync-2-pro",
      "fal-ai/sync-lipsync",
    ])
  })

  it("image-to-video в витрину не попадает — это маршрут, а не выбор пользователя", () => {
    expect(getModel("fal-ai/kling-video/v2.1/standard/image-to-video")).toBeUndefined()
    expect(getModelsByTask("video").map(m => m.id))
      .not.toContain("fal-ai/kling-video/v2.1/standard/image-to-video")
  })

  it("дефолты ведут на Replicate, tier-подбор по-прежнему на fal", () => {
    expect(getDefaultImageModel().id).toBe("black-forest-labs/flux-dev")
    expect(getDefaultVideoModel().id).toBe("kwaivgi/kling-v1.6-standard")
    expect(getDefaultTtsModel()?.id).toBe("minimax/speech-02-turbo")
    expect(getDefaultLipSyncModel()?.id).toBe("kwaivgi/kling-lip-sync")
    // Русский идёт на MiniMax: у Kokoro русского языка нет, а эндпоинта
    // fal-ai/kokoro/russian не существует вовсе (404).
    expect(pickTtsModel({ language: "ru" })?.id).toBe("minimax/speech-02-turbo")
    expect(pickTtsModel({ language: "en", tier: "premium" })?.id).toBe("fal-ai/elevenlabs/tts/turbo-v2.5")

    // Рекомендации по tier не изменились: они выбирают по уровню, а не по провайдеру.
    const balanced = recommendModels("balanced")
    expect(balanced.imageModel.id).toBe("black-forest-labs/flux-dev")
    expect(balanced.videoModel.id).toBe("kwaivgi/kling-v1.6-standard")
    const budget = recommendModels("budget", { language: "ru" })
    expect(budget.imageModel.id).toBe("fal-ai/flux/schnell")
    expect(budget.videoModel.id).toBe("fal-ai/wan/v2.2-a14b/text-to-video")
    expect(budget.ttsModel?.id).toBe("minimax/speech-02-turbo")
  })

  it("прайс витрины и прайс спеки — одно число (дубля $0.014 больше нет)", () => {
    expect(getModel("kwaivgi/kling-lip-sync")?.pricing).toEqual({ unit: "second", base: 0.014 })
    expect(estimateMediaCost(resolveMediaModel("lip_sync"), { outputSeconds: 1 })).toBe(0.014)
    expect(getModel("fal-ai/sync-lipsync")?.pricing).toEqual({ unit: "second", base: 0.067 })
    expect(getModel("fal-ai/kling-video/v3/standard/text-to-video")?.pricing)
      .toEqual({ unit: "second", base: 0.084, withAudio: 0.126 })
    expect(getModel("fal-ai/wan/v2.2-a14b/text-to-video")?.pricing).toEqual({
      unit: "second",
      base: 0.08,
      byResolution: { "480p": 0.04, "580p": 0.06, "720p": 0.08 },
    })
    expect(getModel("fal-ai/flux/schnell")?.pricing).toEqual({ unit: "megapixel", base: 0.003 })
    expect(getModel("fal-ai/kokoro/russian")?.pricing).toEqual({ unit: "audio_second", base: 0.00025 })
    expect(getModel("fal-ai/playai/tts/v3")?.pricing).toEqual({ unit: "character", base: 0.00003 })
  })

  it("метаданные витрины (провайдер, разрешения, длительности) сохранены", () => {
    expect(getModel("fal-ai/flux/schnell")?.provider).toBe("Black Forest Labs")
    expect(getModel("kwaivgi/kling-lip-sync")?.provider).toBe("Replicate / Kuaishou")
    expect(getModel("fal-ai/sync-lipsync")?.provider).toBe("Sync.so / fal.ai")
    expect(getModel("fal-ai/kling-video/v3/standard/text-to-video")?.durationRange).toEqual([3, 15])
    expect(getModel("fal-ai/wan/v2.2-a14b/text-to-video")?.durationOptions).toEqual([3, 5, 7, 10])
    expect(getModel("fal-ai/wan/v2.2-a14b/text-to-video")?.resolutions).toEqual(["480p", "580p", "720p"])
    expect(getModel("fal-ai/kokoro/russian")?.resolutions).toBeUndefined()
    expect(getModel("fal-ai/minimax/hailuo-02/standard/text-to-video")?.integrated).toBe(false)
  })
})
