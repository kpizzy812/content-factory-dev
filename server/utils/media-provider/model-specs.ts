/**
 * Спеки медиамоделей — ДАННЫЕ, а не код в шагах пайплайна.
 *
 * Сюда перенесены существующие модели fal (изображения, text-to-video,
 * image-to-video, TTS, lip-sync-резерв) и Replicate-lip-sync. Вместе с моделью
 * в реестре лежат её маппер входа, разбор выхода, цена, ограничения и таймаут —
 * то есть добавление модели это ОДНА запись, а не правки в
 * `buildClipPayload`, инлайн-payload i2v, `buildProviderInput` и `extractAudioUrl`.
 *
 * Незнакомых моделей здесь быть не может по построению: нет спеки — нет
 * маппера, и раннер честно падает вместо отправки чужого payload в
 * Kling-формате (`video-pipeline-steps.ts:114-123` — так делать нельзя).
 *
 * ВАЖНО про порядок: `video-models.ts` собирает витрину из этого массива, а
 * дефолты берутся как «первая integrated модель способности». Порядок записей
 * повторяет прежний порядок IMAGE_MODELS / VIDEO_MODELS / TTS_MODELS /
 * LIP_SYNC_MODELS — менять его нельзя, это изменит дефолты пайплайна.
 *
 * Моделей Replicate под изображения, видео и речь здесь нет намеренно: их
 * список и тарифы — открытый вопрос к заказчику (§7 спецификации). Каждая
 * добавляется одной записью в этот массив.
 */

import { DEFAULT_REPLICATE_LIPSYNC_MODEL } from "../replicate/config"
import { extractMediaOutput } from "./output"
import type {
  ImageToVideoModelSpec,
  LipSyncModelSpec,
  MediaModelSpec,
  TextToImageModelSpec,
  TextToSpeechModelSpec,
  TextToVideoModelSpec,
} from "./types"

// ─── Общие проверки входа ───────────────────────────────────────

function requireText(value: string | undefined, field: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`Медиавход: поле ${field} обязательно и не может быть пустым`)
  return normalized
}

function requirePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Медиавход: поле ${field} должно быть положительным числом`)
  }
  return value
}

// ─── text_to_image ──────────────────────────────────────────────

const IMAGE_RESOLUTIONS = Object.freeze(["1024x1024", "1080x1920", "1920x1080"])

/**
 * Payload FLUX на fal — байт-в-байт тот же, что шлёт сегодня
 * `runImageGeneration` (`video-pipeline-steps.ts:518-522`) и оба
 * generate-reference эндпоинта: prompt + image_size + num_images.
 *
 * negativePrompt нормализованного входа FLUX не принимает — поле осознанно
 * игнорируется, а не подставляется в чужое имя параметра.
 */
function mapFluxInput(input: {
  prompt: string
  width: number
  height: number
  count: number
  seed?: number
}) {
  const payload: Record<string, unknown> = {
    prompt: requireText(input.prompt, "prompt"),
    image_size: {
      width: requirePositive(input.width, "width"),
      height: requirePositive(input.height, "height"),
    },
    num_images: input.count,
  }
  if (input.seed !== undefined) payload.seed = input.seed
  return { payload }
}

function extractImageOutput(raw: unknown) {
  return extractMediaOutput(raw, {
    priorityKeys: ["images", "image"],
    defaultContentType: "image/png",
  })
}

const FLUX_SCHNELL: TextToImageModelSpec = Object.freeze<TextToImageModelSpec>({
  registryKey: "fal:flux-schnell",
  id: "fal-ai/flux/schnell",
  provider: "fal",
  capability: "text_to_image",
  execution: "sync_queue",
  billing: { unit: "output_megapixel", usdPerMegapixel: 0.003 },
  billingConfirmed: true,
  constraints: Object.freeze({
    resolutions: IMAGE_RESOLUTIONS,
    maxImagesPerRequest: 1,
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    assertImageCount(input.count, this.constraints.maxImagesPerRequest)
    return mapFluxInput(input)
  },
  extractOutput: extractImageOutput,
  dataProcessor: null,
  integrated: true,
  tier: "budget",
  name: "FLUX.1 Schnell",
  vendorLabel: "Black Forest Labs",
  strengths: Object.freeze([
    "Самая быстрая генерация (~0.3с)",
    "В 8x дешевле FLUX Dev",
    "Хорошее качество для черновиков",
  ]),
  tradeoffs: Object.freeze([
    "Меньше деталей, чем FLUX Dev",
    "Max 4 inference steps",
  ]),
  avgGenerationTime: "~0.4 сек",
})

const FLUX_DEV: TextToImageModelSpec = Object.freeze<TextToImageModelSpec>({
  registryKey: "fal:flux-dev",
  id: "fal-ai/flux/dev",
  provider: "fal",
  capability: "text_to_image",
  execution: "sync_queue",
  billing: { unit: "output_megapixel", usdPerMegapixel: 0.025 },
  billingConfirmed: true,
  constraints: Object.freeze({
    resolutions: IMAGE_RESOLUTIONS,
    maxImagesPerRequest: 1,
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    assertImageCount(input.count, this.constraints.maxImagesPerRequest)
    return mapFluxInput(input)
  },
  extractOutput: extractImageOutput,
  dataProcessor: null,
  integrated: true,
  tier: "standard",
  name: "FLUX.1 Dev",
  vendorLabel: "Black Forest Labs",
  strengths: Object.freeze([
    "Высокое качество (12B параметров)",
    "Хорошая детализация и adherence к промпту",
    "Стабильные результаты",
  ]),
  tradeoffs: Object.freeze([
    "Дороже FLUX Schnell в 8x",
    "Медленнее (~2 сек)",
  ]),
  avgGenerationTime: "~2 сек",
})

function assertImageCount(count: number, max: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Медиавход: count должен быть целым числом от 1")
  }
  if (count > max) {
    throw new Error(
      `Медиавход: запрошено ${count} изображений, разрешено ${max} — разбор выхода берёт один URL на единицу работы`,
    )
  }
}

// ─── text_to_video / image_to_video ─────────────────────────────

function extractVideoOutput(raw: unknown) {
  return extractMediaOutput(raw, {
    priorityKeys: ["video"],
    defaultContentType: "video/mp4",
  })
}

/** Таймаут клипов — не меньше 30 минут (§3.4): Kling заявлен как 5–15 мин, i2v дольше. */
const VIDEO_TIMEOUT_MS = 30 * 60_000
const IMAGE_TO_VIDEO_TIMEOUT_MS = 40 * 60_000

const KLING_ASPECT_RATIOS = Object.freeze(["9:16", "16:9", "1:1"] as const)

/** Payload Kling text-to-video — как в `buildClipPayload` (`video-pipeline-steps.ts:81-89`). */
function mapKlingTextToVideo(input: {
  prompt: string
  durationSec: number
  aspectRatio: "9:16" | "16:9" | "1:1"
  withAudio: boolean
  negativePrompt?: string
}) {
  const durationSec = requirePositive(input.durationSec, "durationSec")
  return {
    payload: {
      prompt: requireText(input.prompt, "prompt"),
      duration: String(durationSec),
      aspect_ratio: input.aspectRatio,
      generate_audio: input.withAudio,
      negative_prompt: input.negativePrompt ?? "",
    },
    // Kling v3 берёт длительность как есть — квантования нет.
    effectiveDurationSec: durationSec,
  }
}

const KLING_V3_STANDARD: TextToVideoModelSpec = Object.freeze<TextToVideoModelSpec>({
  registryKey: "fal:kling-v3-standard-t2v",
  id: "fal-ai/kling-video/v3/standard/text-to-video",
  provider: "fal",
  capability: "text_to_video",
  execution: "sync_queue",
  billing: {
    unit: "output_second",
    usdPerSecond: 0.084,
    usdPerSecondWithAudio: 0.126,
  },
  billingConfirmed: true,
  constraints: Object.freeze({
    aspectRatios: KLING_ASPECT_RATIOS,
    resolutions: Object.freeze(["1920x1080", "1080x1920", "1080x1080"]),
    durationRange: Object.freeze([3, 15] as const),
    supportsAudio: true,
    requiresImage: false,
  }),
  timeoutMs: VIDEO_TIMEOUT_MS,
  mapInput: mapKlingTextToVideo,
  extractOutput: extractVideoOutput,
  dataProcessor: null,
  integrated: true,
  tier: "standard",
  name: "Kling 3.0 Standard",
  vendorLabel: "Kuaishou",
  strengths: Object.freeze([
    "До 15 сек видео",
    "Встроенная генерация аудио",
    "Хорошая кинематографичность",
    "Подключён к pipeline",
  ]),
  tradeoffs: Object.freeze([
    "Долгая генерация (5–15 мин)",
    "Дороже Hailuo Standard",
  ]),
  avgGenerationTime: "5–15 мин",
})

const KLING_V3_PRO: TextToVideoModelSpec = Object.freeze<TextToVideoModelSpec>({
  registryKey: "fal:kling-v3-pro-t2v",
  id: "fal-ai/kling-video/v3/pro/text-to-video",
  provider: "fal",
  capability: "text_to_video",
  execution: "sync_queue",
  billing: {
    unit: "output_second",
    usdPerSecond: 0.112,
    usdPerSecondWithAudio: 0.168,
  },
  billingConfirmed: true,
  constraints: Object.freeze({
    aspectRatios: KLING_ASPECT_RATIOS,
    resolutions: Object.freeze(["1920x1080", "1080x1920", "1080x1080"]),
    durationRange: Object.freeze([3, 15] as const),
    supportsAudio: true,
    requiresImage: false,
  }),
  timeoutMs: VIDEO_TIMEOUT_MS,
  mapInput: mapKlingTextToVideo,
  extractOutput: extractVideoOutput,
  dataProcessor: null,
  integrated: false,
  tier: "premium",
  name: "Kling 3.0 Pro",
  vendorLabel: "Kuaishou",
  strengths: Object.freeze([
    "Максимальное качество видео",
    "Лучшая кинематографичность",
    "Встроенная генерация аудио",
  ]),
  tradeoffs: Object.freeze([
    "На 33% дороже Standard",
    "Ещё более долгая генерация",
  ]),
  avgGenerationTime: "8–20 мин",
})

/** Wan считает длительность кадрами: num_frames / frames_per_second. */
const WAN_FPS = 16
const WAN_MIN_FRAMES = 17
const WAN_MAX_FRAMES = 161

const WAN_V22: TextToVideoModelSpec = Object.freeze<TextToVideoModelSpec>({
  registryKey: "fal:wan-v2.2-a14b-t2v",
  id: "fal-ai/wan/v2.2-a14b/text-to-video",
  provider: "fal",
  capability: "text_to_video",
  execution: "sync_queue",
  billing: {
    // 720p — наш default. Wan не имеет встроенного аудио, поэтому
    // usdPerSecondWithAudio отсутствует, а не равен базовой цене.
    unit: "output_second",
    usdPerSecond: 0.08,
    byResolution: Object.freeze({
      "480p": 0.04,
      "580p": 0.06,
      "720p": 0.08,
    }),
  },
  billingConfirmed: true,
  constraints: Object.freeze({
    aspectRatios: KLING_ASPECT_RATIOS,
    resolutions: Object.freeze(["480p", "580p", "720p"]),
    durationOptions: Object.freeze([3, 5, 7, 10]),
    supportsAudio: false,
    requiresImage: false,
  }),
  timeoutMs: VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const durationSec = requirePositive(input.durationSec, "durationSec")
    const numFrames = Math.max(
      WAN_MIN_FRAMES,
      Math.min(WAN_MAX_FRAMES, Math.round(durationSec * WAN_FPS)),
    )
    return {
      payload: {
        prompt: requireText(input.prompt, "prompt"),
        num_frames: numFrames,
        frames_per_second: WAN_FPS,
        aspect_ratio: input.aspectRatio,
        negative_prompt: input.negativePrompt ?? "",
        resolution: input.resolution ?? "720p",
      },
      // Квантование по кадрам: заказали 6.4с — получим 102/16 = 6.375с.
      // Деньги и таймлайн считаются по этому числу, а не по запрошенному.
      effectiveDurationSec: numFrames / WAN_FPS,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: null,
  integrated: true,
  tier: "budget",
  name: "Wan 2.2 (a14b)",
  vendorLabel: "Alibaba / fal.ai",
  strengths: Object.freeze([
    "Лучшая цена на 480p ($0.04/сек)",
    "Быстрая генерация (≤ 3 мин)",
    "Самостоятельный визуальный стиль (Alibaba Wan)",
    "Поддерживает 9:16 / 16:9 / 1:1",
  ]),
  tradeoffs: Object.freeze([
    "Только 720p max (без 1080p)",
    "Без встроенного аудио (используйте TTS + музыку)",
    "Меньше cinematic quality чем Kling Pro",
  ]),
  avgGenerationTime: "1-3 мин",
})

const HAILUO_02_STANDARD: TextToVideoModelSpec = Object.freeze<TextToVideoModelSpec>({
  registryKey: "fal:hailuo-02-standard-t2v",
  id: "fal-ai/minimax/hailuo-02/standard/text-to-video",
  provider: "fal",
  capability: "text_to_video",
  execution: "sync_queue",
  billing: { unit: "output_second", usdPerSecond: 0.045 },
  billingConfirmed: true,
  constraints: Object.freeze({
    aspectRatios: KLING_ASPECT_RATIOS,
    resolutions: Object.freeze(["768p"]),
    durationOptions: Object.freeze([5, 10]),
    supportsAudio: false,
    requiresImage: false,
  }),
  timeoutMs: VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const durationSec = requirePositive(input.durationSec, "durationSec")
    const quantized = durationSec >= 7 ? 10 : 5
    return {
      payload: {
        prompt: requireText(input.prompt, "prompt"),
        duration: quantized,
        prompt_optimizer: true,
      },
      effectiveDurationSec: quantized,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: null,
  integrated: false,
  tier: "budget",
  name: "Hailuo-02 Standard",
  vendorLabel: "MiniMax",
  strengths: Object.freeze([
    "Самый дешёвый вариант",
    "Быстрая генерация",
  ]),
  tradeoffs: Object.freeze([
    "Только 768p разрешение",
    "Только 5 или 10 сек",
    "Не подключён к pipeline",
  ]),
  avgGenerationTime: "2–5 мин",
})

/**
 * Image-to-video. Endpoint сегодня зашит константой
 * `KLING_IMAGE_TO_VIDEO_ENDPOINT` (`video-pipeline-steps.ts:52`) и в реестре
 * моделей отсутствует вовсе — из-за этого i2v-сцена считается по цене выбранной
 * text-to-video модели.
 *
 * ЦЕНА НЕ ПОДТВЕРЖДЕНА (`billingConfirmed: false`): тариф fal за секунду
 * Kling v2.1 standard i2v в проекте нигде не зафиксирован. До подтверждения по
 * странице модели или счёту аккаунта держим текущую де-факто ставку, по которой
 * эти сцены оплачиваются сегодня (Kling v3 standard, $0.084/с) — так смета не
 * занижается. Шаг 7 плана обязан заменить число подтверждённым.
 */
const KLING_V21_IMAGE_TO_VIDEO: ImageToVideoModelSpec = Object.freeze<ImageToVideoModelSpec>({
  registryKey: "fal:kling-v2.1-standard-i2v",
  id: "fal-ai/kling-video/v2.1/standard/image-to-video",
  provider: "fal",
  capability: "image_to_video",
  execution: "sync_queue",
  billing: { unit: "output_second", usdPerSecond: 0.084 },
  billingConfirmed: false,
  constraints: Object.freeze({
    aspectRatios: KLING_ASPECT_RATIOS,
    resolutions: Object.freeze(["1920x1080", "1080x1920", "1080x1080"]),
    durationOptions: Object.freeze([5, 10]),
    supportsAudio: false,
    requiresImage: true,
  }),
  timeoutMs: IMAGE_TO_VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const durationSec = requirePositive(input.durationSec, "durationSec")
    // v2.1 standard принимает только duration "5" или "10" (прежний
    // clampKlingI2vDuration). Реальная длина клипа в timeline не меняется —
    // assemble отрежет по исходной, но платим и планируем по этому числу.
    const quantized = durationSec > 7 ? 10 : 5
    return {
      payload: {
        prompt: requireText(input.prompt, "prompt"),
        image_url: requireText(input.imageUrl, "imageUrl"),
        duration: String(quantized),
        aspect_ratio: input.aspectRatio,
        negative_prompt: input.negativePrompt ?? "",
      },
      effectiveDurationSec: quantized,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: null,
  integrated: true,
  tier: "standard",
  name: "Kling 2.1 Standard (image-to-video)",
  vendorLabel: "Kuaishou",
  strengths: Object.freeze([
    "Оживляет скриншот приложения без потери интерфейса",
    "Единственный подключённый маршрут для сцен с appScreenRef",
  ]),
  tradeoffs: Object.freeze([
    "Длительность только 5 или 10 секунд",
    "Цена за секунду не подтверждена — смета оценочная",
  ]),
  avgGenerationTime: "5–15 мин",
})

// ─── text_to_speech ─────────────────────────────────────────────

function extractAudioOutput(raw: unknown) {
  return extractMediaOutput(raw, {
    priorityKeys: ["audio"],
    defaultContentType: "audio/mpeg",
  })
}

const TTS_LANGUAGES_MULTI = Object.freeze(["en", "ru", "de", "fr", "es", "it", "pt", "pl"])

const KOKORO_EN: TextToSpeechModelSpec = Object.freeze<TextToSpeechModelSpec>({
  registryKey: "fal:kokoro-american-english",
  id: "fal-ai/kokoro/american-english",
  provider: "fal",
  capability: "text_to_speech",
  execution: "sync_queue",
  billing: { unit: "audio_second", usdPerSecond: 0.00025 },
  billingConfirmed: true,
  constraints: Object.freeze({
    maxCharacters: 5000,
    languages: Object.freeze(["en"]),
    formats: Object.freeze(["mp3"]),
  }),
  timeoutMs: 2 * 60_000,
  mapInput(input) {
    return {
      payload: {
        prompt: requireText(input.text, "text"),
        voice: requireText(input.voiceId, "voiceId"),
        speed: input.speed,
      },
    }
  },
  extractOutput: extractAudioOutput,
  voices: Object.freeze({ default: "af_heart", envOverrideKey: "DEFAULT_TTS_VOICE_EN" }),
  dataProcessor: null,
  integrated: true,
  tier: "budget",
  name: "Kokoro (American English)",
  vendorLabel: "Hexgrad / fal.ai",
  strengths: Object.freeze([
    "Open-source, самый дешёвый TTS",
    "Быстрая синтез (~2-3x realtime)",
    "Естественная интонация на английском",
    "Множество голосов (male/female)",
  ]),
  tradeoffs: Object.freeze([
    "Только американский английский",
    "Ограниченный emotional range",
  ]),
  avgGenerationTime: "~3-5 сек на фразу",
})

const KOKORO_RU: TextToSpeechModelSpec = Object.freeze<TextToSpeechModelSpec>({
  registryKey: "fal:kokoro-russian",
  id: "fal-ai/kokoro/russian",
  provider: "fal",
  capability: "text_to_speech",
  execution: "sync_queue",
  billing: { unit: "audio_second", usdPerSecond: 0.00025 },
  billingConfirmed: true,
  constraints: Object.freeze({
    maxCharacters: 5000,
    languages: Object.freeze(["ru"]),
    formats: Object.freeze(["mp3"]),
  }),
  timeoutMs: 2 * 60_000,
  mapInput(input) {
    return {
      payload: {
        prompt: requireText(input.text, "text"),
        voice: requireText(input.voiceId, "voiceId"),
        speed: input.speed,
      },
    }
  },
  extractOutput: extractAudioOutput,
  voices: Object.freeze({ default: "bf_emma", envOverrideKey: "DEFAULT_TTS_VOICE_RU" }),
  dataProcessor: null,
  integrated: true,
  tier: "budget",
  name: "Kokoro (Russian)",
  vendorLabel: "Hexgrad / fal.ai",
  strengths: Object.freeze([
    "Русский TTS, open-source",
    "Быстрая синтез",
  ]),
  tradeoffs: Object.freeze([
    "Менее естественный чем ElevenLabs",
    "Ограниченный набор голосов",
  ]),
  avgGenerationTime: "~3-5 сек",
})

const PLAYAI_V3: TextToSpeechModelSpec = Object.freeze<TextToSpeechModelSpec>({
  registryKey: "fal:playai-tts-v3",
  id: "fal-ai/playai/tts/v3",
  provider: "fal",
  capability: "text_to_speech",
  execution: "sync_queue",
  billing: { unit: "character", usdPerCharacter: 0.00003 },
  billingConfirmed: true,
  constraints: Object.freeze({
    maxCharacters: 5000,
    languages: TTS_LANGUAGES_MULTI,
    formats: Object.freeze(["mp3", "wav"]),
  }),
  timeoutMs: 2 * 60_000,
  mapInput(input) {
    return {
      payload: {
        input: requireText(input.text, "text"),
        voice: requireText(input.voiceId, "voiceId"),
        response_format: input.format,
        // PlayAI "speed" range: 0.5-2.0
        speed: input.speed,
      },
    }
  },
  extractOutput: extractAudioOutput,
  voices: Object.freeze({
    default: "s3://voice-cloning-zero-shot/820da3f2-2b81-4a43-9ed3-4e1a2b7f2c34/original/manifest.json",
    byLanguage: Object.freeze({
      ru: "s3://voice-cloning-zero-shot/baf1ef41-36b6-428c-9bdf-50ba54682bd8/original/manifest.json",
    }),
  }),
  dataProcessor: null,
  integrated: true,
  tier: "standard",
  name: "PlayAI TTS v3",
  vendorLabel: "PlayAI / fal.ai",
  strengths: Object.freeze([
    "Высокое качество голоса",
    "Expressive эмоциональная окраска",
    "Multiple languages",
  ]),
  tradeoffs: Object.freeze([
    "Дороже Kokoro в 3-5x",
  ]),
  avgGenerationTime: "~5-10 сек",
})

const ELEVENLABS_TURBO: TextToSpeechModelSpec = Object.freeze<TextToSpeechModelSpec>({
  registryKey: "fal:elevenlabs-turbo-v2.5",
  id: "fal-ai/elevenlabs/tts/turbo-v2.5",
  provider: "fal",
  capability: "text_to_speech",
  execution: "sync_queue",
  billing: { unit: "character", usdPerCharacter: 0.00015 },
  billingConfirmed: true,
  constraints: Object.freeze({
    maxCharacters: 5000,
    languages: TTS_LANGUAGES_MULTI,
    formats: Object.freeze(["mp3"]),
  }),
  timeoutMs: 2 * 60_000,
  mapInput(input) {
    return {
      payload: {
        text: requireText(input.text, "text"),
        voice: requireText(input.voiceId, "voiceId"),
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }
  },
  extractOutput: extractAudioOutput,
  voices: Object.freeze({ default: "Rachel" }),
  dataProcessor: null,
  integrated: true,
  tier: "premium",
  name: "ElevenLabs Turbo v2.5",
  vendorLabel: "ElevenLabs / fal.ai",
  strengths: Object.freeze([
    "Максимальное качество голоса",
    "Emotional range и character continuity",
    "29 языков",
    "Low latency (turbo)",
  ]),
  tradeoffs: Object.freeze([
    "Самый дорогой TTS вариант",
    "Требует доступ ElevenLabs через fal",
  ]),
  avgGenerationTime: "~2-4 сек",
})

// ─── lip_sync ───────────────────────────────────────────────────

const LIP_SYNC_CONSTRAINTS = Object.freeze({
  videoExtensions: Object.freeze(["mp4", "mov"]),
  audioExtensions: Object.freeze(["mp3", "wav", "m4a", "aac"]),
  minDurationSec: 2,
  maxDurationSec: 10,
  minWidth: 720,
  maxWidth: 1080,
  minHeight: 720,
  maxHeight: 1920,
  maxVideoBytes: 100 * 1024 * 1024,
  maxAudioBytes: 5 * 1024 * 1024,
})

const KLING_LIP_SYNC: LipSyncModelSpec = Object.freeze<LipSyncModelSpec>({
  registryKey: "replicate:kling-lip-sync",
  id: DEFAULT_REPLICATE_LIPSYNC_MODEL,
  provider: "replicate",
  capability: "lip_sync",
  execution: "async_prediction",
  billing: { unit: "output_second", usdPerSecond: 0.014 },
  billingConfirmed: true,
  constraints: LIP_SYNC_CONSTRAINTS,
  timeoutMs: 15 * 60_000,
  mapInput(input) {
    return {
      payload: {
        video_url: requireText(input.videoUrl, "videoUrl"),
        audio_file: requireText(input.audioUrl, "audioUrl"),
      },
    }
  },
  extractOutput(raw) {
    return extractMediaOutput(raw, { priorityKeys: ["video"], defaultContentType: "video/mp4" })
  },
  dataProcessor: Object.freeze({
    name: "Kuaishou",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "budget",
  name: "Kling Lip Sync",
  vendorLabel: "Replicate / Kuaishou",
  strengths: Object.freeze([
    "Дешёвый липсинк готового видео",
    "Подходит для коротких сцен с аватаром",
    "Асинхронный API с восстановлением задач",
  ]),
  tradeoffs: Object.freeze([
    "Исходный клип должен быть длиной 2-10 секунд",
    "Данные модели обрабатываются Kuaishou",
  ]),
  avgGenerationTime: "~30-90 сек на сцену",
})

/**
 * fal-резерв lip-sync. Его id и цена жили литералами в
 * `media-provider/lip-sync.ts:26-27` — теперь источник один, реестр.
 * Ограничения совпадают с Kling намеренно: раньше при неизвестной модели
 * `resolveModelDurationRange` (`lip-sync-runner.ts:698-710`) отдавал те же 2-10.
 */
const FAL_SYNC_LIPSYNC: LipSyncModelSpec = Object.freeze<LipSyncModelSpec>({
  registryKey: "fal:sync-lipsync",
  id: "fal-ai/sync-lipsync",
  provider: "fal",
  capability: "lip_sync",
  execution: "sync_queue",
  // Биллинг fal.ai per second of OUTPUT video. Реальная цена смотрится
  // на странице модели в fal.ai dashboard, текущая оценка ~$0.067.
  billing: { unit: "output_second", usdPerSecond: 0.067 },
  billingConfirmed: true,
  constraints: LIP_SYNC_CONSTRAINTS,
  timeoutMs: 15 * 60_000,
  mapInput(input) {
    return {
      payload: {
        video_url: requireText(input.videoUrl, "videoUrl"),
        audio_url: requireText(input.audioUrl, "audioUrl"),
        sync_mode: "cut_off",
      },
    }
  },
  extractOutput(raw) {
    return extractMediaOutput(raw, { priorityKeys: ["video"], defaultContentType: "video/mp4" })
  },
  dataProcessor: null,
  integrated: false,
  tier: "premium",
  name: "Sync Lipsync v1",
  vendorLabel: "Sync.so / fal.ai",
  strengths: Object.freeze([
    "Sync video с произвольным аудио",
    "Работает с готовыми клипами Kling",
    "Сохраняет original facial expression",
  ]),
  tradeoffs: Object.freeze([
    "+~$0.07 за каждую секунду lip-synced сцены",
    "Требует TTS для генерации голоса персонажа",
  ]),
  avgGenerationTime: "~30-60 сек на сцену",
})

/**
 * Порядок значим: витрина и дефолты («первая integrated модель способности»)
 * читают этот массив сверху вниз.
 */
export const MEDIA_MODEL_SPECS: readonly MediaModelSpec[] = Object.freeze([
  FLUX_SCHNELL,
  FLUX_DEV,
  KLING_V3_STANDARD,
  KLING_V3_PRO,
  WAN_V22,
  HAILUO_02_STANDARD,
  KLING_V21_IMAGE_TO_VIDEO,
  KOKORO_EN,
  KOKORO_RU,
  PLAYAI_V3,
  ELEVENLABS_TURBO,
  KLING_LIP_SYNC,
  FAL_SYNC_LIPSYNC,
])
