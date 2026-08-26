/**
 * Спеки медиамоделей — ДАННЫЕ, а не код в шагах пайплайна.
 *
 * Сюда перенесены существующие модели fal (изображения, text-to-video,
 * image-to-video, TTS, lip-sync-резерв) и Replicate-lip-sync. Вместе с моделью
 * в реестре лежат её маппер входа, разбор выхода, цена, ограничения и таймаут —
 * то есть добавление модели это ОДНА запись, а не правки в четырёх местах:
 * сборщик payload клипов, инлайн-payload i2v, сборщик и парсер TTS.
 *
 * Незнакомых моделей здесь быть не может по построению: нет спеки — нет
 * маппера, и раннер честно падает вместо отправки чужого payload в
 * Kling-формате (шаг клипов раньше именно так и делал — так делать нельзя).
 *
 * ВАЖНО про порядок: `video-models.ts` собирает витрину из этого массива, а
 * дефолты берутся как «первая integrated модель способности». Порядок записей
 * повторяет прежний порядок IMAGE_MODELS / VIDEO_MODELS / TTS_MODELS /
 * LIP_SYNC_MODELS — менять его нельзя, это изменит дефолты пайплайна.
 *
 * Модели Replicate под кадры, клипы и речь — те, что уже обкатаны на стенде
 * (flux-dev, kling-v1.6-standard, minimax/speech-02-turbo). Их цены не выдуманы,
 * а взяты из переменных окружения с теми же дефолтами, по которым они
 * оплачивались на стенде, и помечены `billingConfirmed: false`: canary по
 * `docs/operations/replicate.md` по ним ещё никто не проводил.
 */

import { DEFAULT_REPLICATE_LIPSYNC_MODEL, DEFAULT_REPLICATE_TTS_MODEL } from "../replicate/config"
import { extractMediaOutput } from "./output"
import type {
  ImageToImageModelSpec,
  ImageToVideoModelSpec,
  LipSyncModelSpec,
  MediaModelSpec,
  SpeechToVideoModelSpec,
  TextToImageModelSpec,
  TextToSpeechModelSpec,
  TextToVideoModelSpec,
  TranscriptionModelSpec,
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

/**
 * Цена Replicate из окружения.
 *
 * Replicate не отдаёт тарифы через публичный API, поэтому число живёт в env с
 * дефолтом, по которому эти модели фактически оплачивались на стенде. Читается
 * ЛЕНИВО, при обращении к спеке: реестр импортируется в том числе тестами, и
 * бросать на этапе импорта модуля из-за кривой переменной нельзя.
 *
 * ЕДИНСТВЕННОЕ место, где различаются три разных случая (Important 3
 * финального ревью ветки — раньше часть этого решения дублировалась броском
 * внутри геттера спеки, и он ронял витрину моделей и старый маршрут):
 *  * переменной нет (или она пустая) — тариф не задан, берётся дефолт спеки;
 *  * значение нечисловое или отрицательное — это мусор, отказ;
 *  * ноль — ЛЕГАЛЬНОЕ значение: «модель бесплатна / не тарифицируется».
 *    Оператор, которому нужно ВЫКЛЮЧИТЬ генерацию, а не объявить её
 *    бесплатной, пользуется `EditProfile.imageGenerationEnabled`.
 */
function readReplicatePrice(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${envKey} должен быть неотрицательным числом`)
  }
  return parsed
}

/**
 * Пропорция кадра в нотации модели. Нормализованный вход несёт width/height, а
 * у моделей Replicate список пропорций закрытый: просим настоящую вертикаль,
 * если модель её знает, иначе самую узкую из доступных — обрезать лишнее по
 * краям дешевле, чем дорисовывать.
 */
function pickAspectRatio(supported: readonly string[], width: number, height: number): string {
  if (width > height) {
    return supported.includes("16:9") ? "16:9" : supported[0]!
  }
  if (width === height) {
    return supported.includes("1:1") ? "1:1" : supported[0]!
  }
  const portraitPreference = ["9:16", "2:3", "3:4", "4:5", "1:1"]
  return portraitPreference.find(ratio => supported.includes(ratio)) ?? supported[0]!
}

/**
 * Ближайшая допустимая длительность НЕ МЕНЬШЕ запрошенной: лишнее подрежет
 * монтаж, а недостачу восполнить нечем.
 */
function pickDuration(supported: readonly number[], requestedSec: number): number {
  const sorted = [...supported].sort((a, b) => a - b)
  return sorted.find(value => value >= requestedSec) ?? sorted[sorted.length - 1]!
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

const REPLICATE_FLUX_ASPECT_RATIOS = Object.freeze([
  "1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4",
])

/**
 * FLUX.1 [dev] на Replicate — основной провайдер кадров (PROJECT_CONTEXT §5).
 *
 * Списка 9:16 у модели нет: самая близкая вертикаль — 2:3. Для превью этого
 * достаточно, а сцены снимает text-to-video напрямую, без промежуточной картинки.
 *
 * Цена — за изображение, а не за мегапиксель: тариф $0.025 за кадр
 * переопределяется REPLICATE_IMAGE_PRICE_USD. Подтверждён страницей модели
 * 14.08.2026 («or 40 images for $1»).
 */
const FLUX_DEV_REPLICATE: TextToImageModelSpec = Object.freeze<TextToImageModelSpec>({
  registryKey: "replicate:flux-dev",
  id: "black-forest-labs/flux-dev",
  provider: "replicate",
  capability: "text_to_image",
  execution: "async_prediction",
  get billing() {
    // Important 3 финального ревью ветки: здесь стоял бросок при
    // `REPLICATE_IMAGE_PRICE_USD=0`. Геттер читают не только деньги плана
    // монтажа: витрина моделей (`video-models.ts`) вызывает `toPricing`
    // на КАЖДУЮ спеку прямо при импорте модуля, а `run-media-task` — на
    // каждой медиазадаче, в том числе на СТАРОМ маршруте. Под этой настройкой
    // окружения падала не одна ручка, а весь модуль витрины и любая генерация
    // картинки — нарушение «старый маршрут не ломается».
    //
    // Рулинг: ноль — легальное значение («модель бесплатна / не
    // тарифицируется»), а не мусор. Отличать ноль от ОТСУТСТВУЮЩЕГО значения и
    // от нечислового — работа `readReplicatePrice`, и делается она там: нет
    // переменной → дефолт спеки, нечисловое/отрицательное → отказ, ноль →
    // ноль. Оператору, который хочет ВЫКЛЮЧИТЬ генерацию картинок, а не
    // объявить их бесплатными, по-прежнему нужен
    // `EditProfile.imageGenerationEnabled=false` — но это его выбор, а не
    // повод ронять чужие маршруты.
    return { unit: "output_image", usdPerImage: readReplicatePrice("REPLICATE_IMAGE_PRICE_USD", 0.025) } as const
  },
  billingConfirmed: true,
  constraints: Object.freeze({
    resolutions: Object.freeze(["1024x1024", "832x1248", "1248x832"]),
    maxImagesPerRequest: 1,
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    assertImageCount(input.count, this.constraints.maxImagesPerRequest)
    const width = requirePositive(input.width, "width")
    const height = requirePositive(input.height, "height")
    const payload: Record<string, unknown> = {
      prompt: requireText(input.prompt, "prompt"),
      aspect_ratio: pickAspectRatio(REPLICATE_FLUX_ASPECT_RATIOS, width, height),
      output_format: "jpg",
      num_outputs: input.count,
    }
    if (input.seed !== undefined) payload.seed = input.seed
    return { payload }
  },
  extractOutput: extractImageOutput,
  dataProcessor: Object.freeze({
    name: "Black Forest Labs",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "standard",
  name: "FLUX.1 Dev (Replicate)",
  vendorLabel: "Replicate / Black Forest Labs",
  strengths: Object.freeze([
    "Основной провайдер: тот же контур predictions, что у lip-sync",
    "Идемпотентность по промпту сцены — повтор не оплачивается второй раз",
    "Результат сразу переносится в постоянное хранилище",
  ]),
  tradeoffs: Object.freeze([
    "Нет пропорции 9:16 — самая близкая вертикаль 2:3",
    "Цена за кадр не подтверждена canary — смета считается по ставке стенда",
  ]),
  avgGenerationTime: "~10 сек",
})

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

/** Payload Kling text-to-video — как в прежнем сборщике payload шага клипов. */
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

const REPLICATE_KLING_16_ID = "kwaivgi/kling-v1.6-standard"
/**
 * Экспортирован (ре-ревью Task 4, М-8): единственный законный источник границ
 * квантования генеративного видео (5/10 с). До этого `edit-plan/background-source.ts`
 * получал `minGenerativeVideoSec`/`maxGenerativeVideoSec` параметрами без
 * общедоступного источника значений — вызывающий код был обречён хардкодить
 * `5`/`10` сам, ровно то, что докстринг того же файла запрещает делать со ставкой.
 */
export const REPLICATE_KLING_16_DURATIONS = Object.freeze([5, 10])

/**
 * Цена Kling 1.6 на Replicate — за секунду выхода, override через env.
 *
 * $0.05 подтверждено страницей модели 14.08.2026 («or 20 seconds for $1»).
 * До этого стояло $0.045 «как оплачивалось на стенде» — смета клипов была
 * занижена на 11%, а заниженная смета уводит партию за пределы кошелька молча.
 *
 * Экспортирована (Task 5, edit-plan/runner.ts): раннер плана монтажа обязан
 * считать бюджет генеративного фона по ЭТОЙ ЖЕ ставке, а не заводить свой
 * литерал $0.05 — ровно та ошибка, ради которой существует докстринг
 * `background-source.ts` про заниженную смету.
 */
export function replicateVideoBilling() {
  return {
    unit: "output_second",
    usdPerSecond: readReplicatePrice("REPLICATE_VIDEO_PRICE_USD_PER_SEC", 0.05),
  } as const
}

/**
 * Kling 1.6 Standard на Replicate — основной провайдер клипов (PROJECT_CONTEXT §5).
 *
 * Единственная из проверенных моделей Kuaishou на Replicate, которая умеет и
 * text-to-video, и image-to-video. Длительность принимает только 5 или 10 секунд,
 * поэтому сцену на 9 секунд она снимет десятисекундной, а лишнее подрежет монтаж —
 * платим и планируем по `effectiveDurationSec`, а не по запрошенному числу.
 *
 * `billingConfirmed: false` — ставка $0.045/с подтверждена практикой стенда, но
 * не canary по `docs/operations/replicate.md`.
 */
const REPLICATE_KLING_16_T2V: TextToVideoModelSpec = Object.freeze<TextToVideoModelSpec>({
  registryKey: "replicate:kling-v1.6-standard-t2v",
  id: REPLICATE_KLING_16_ID,
  provider: "replicate",
  capability: "text_to_video",
  execution: "async_prediction",
  get billing() {
    return replicateVideoBilling()
  },
  billingConfirmed: true,
  constraints: Object.freeze({
    aspectRatios: KLING_ASPECT_RATIOS,
    resolutions: Object.freeze(["1080x1920", "1920x1080", "1080x1080"]),
    durationOptions: REPLICATE_KLING_16_DURATIONS,
    supportsAudio: false,
    requiresImage: false,
  }),
  timeoutMs: VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const requestedSec = requirePositive(input.durationSec, "durationSec")
    const quantized = pickDuration(REPLICATE_KLING_16_DURATIONS, requestedSec)
    return {
      payload: {
        prompt: requireText(input.prompt, "prompt"),
        duration: quantized,
        aspect_ratio: input.aspectRatio,
        ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      },
      effectiveDurationSec: quantized,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: Object.freeze({
    name: "Kuaishou",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "standard",
  name: "Kling 1.6 Standard (Replicate)",
  vendorLabel: "Replicate / Kuaishou",
  strengths: Object.freeze([
    "Основной провайдер: тот же контур predictions, что у lip-sync",
    "Идемпотентность: повторный запуск не оплачивает сцену второй раз",
    "Результат сразу переносится в постоянное хранилище",
  ]),
  tradeoffs: Object.freeze([
    "Длительность только 5 или 10 секунд",
    "Без встроенной генерации звука",
    "Цена за секунду не подтверждена canary",
  ]),
  avgGenerationTime: "3-8 мин",
})

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
 * Image-to-video. Раньше endpoint был зашит константой в шаге клипов и в
 * реестре моделей отсутствовал вовсе — из-за этого i2v-сцена считалась по цене
 * выбранной text-to-video модели. Теперь маршрут способности берётся отсюда.
 *
 * ЦЕНА НЕ ПОДТВЕРЖДЕНА (`billingConfirmed: false`): тариф fal за секунду
 * Kling v2.1 standard i2v в проекте нигде не зафиксирован. До подтверждения по
 * странице модели или счёту аккаунта держим текущую де-факто ставку, по которой
 * эти сцены оплачиваются сегодня (Kling v3 standard, $0.084/с) — так смета не
 * занижается. Шаг 7 плана обязан заменить число подтверждённым.
 */
/**
 * Тот же Kling 1.6 на Replicate, но со стартовым кадром.
 *
 * Основной маршрут image-to-video: способность оживляет любой опорный кадр —
 * портрет ведущего для AI-аватара, референс сцены, кадр приложения. Ставка та
 * же, что у t2v той же модели (`replicateVideoBilling`), поэтому включение не
 * ухудшает точность сметы по сравнению с fal, где $0.084/с тоже не подтверждены.
 * `billingConfirmed: false` снимается canary по `docs/operations/replicate.md`.
 */
const REPLICATE_KLING_16_I2V: ImageToVideoModelSpec = Object.freeze<ImageToVideoModelSpec>({
  registryKey: "replicate:kling-v1.6-standard-i2v",
  id: REPLICATE_KLING_16_ID,
  provider: "replicate",
  capability: "image_to_video",
  execution: "async_prediction",
  get billing() {
    return replicateVideoBilling()
  },
  billingConfirmed: true,
  constraints: Object.freeze({
    aspectRatios: KLING_ASPECT_RATIOS,
    resolutions: Object.freeze(["1080x1920", "1920x1080", "1080x1080"]),
    durationOptions: REPLICATE_KLING_16_DURATIONS,
    supportsAudio: false,
    requiresImage: true,
  }),
  timeoutMs: IMAGE_TO_VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const requestedSec = requirePositive(input.durationSec, "durationSec")
    const quantized = pickDuration(REPLICATE_KLING_16_DURATIONS, requestedSec)
    return {
      payload: {
        prompt: requireText(input.prompt, "prompt"),
        start_image: requireText(input.imageUrl, "imageUrl"),
        duration: quantized,
        aspect_ratio: input.aspectRatio,
        ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      },
      effectiveDurationSec: quantized,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: Object.freeze({
    name: "Kuaishou",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "standard",
  name: "Kling 1.6 Standard (Replicate, image-to-video)",
  vendorLabel: "Replicate / Kuaishou",
  strengths: Object.freeze([
    "Оживляет опорный кадр тем же контуром predictions, что и остальные способности",
    "Идемпотентность по отпечатку опорного кадра",
    "Результат сразу переносится в постоянное хранилище",
  ]),
  tradeoffs: Object.freeze([
    "Длительность только 5 или 10 секунд",
    "Цена за секунду не подтверждена canary",
  ]),
  avgGenerationTime: "3-8 мин",
})

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
    // v2.1 standard принимает только duration "5" или "10" (прежнее
    // квантование в шаге клипов). Реальная длина клипа в timeline не меняется —
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

/** MiniMax принимает язык отдельным полем language_boost, в своей нотации. */
const MINIMAX_LANGUAGE_BOOST: Record<string, string> = {
  ru: "Russian",
  en: "English",
}

/**
 * Эмоция у MiniMax — закрытый список, а сценарист пишет её свободным текстом
 * («лёгкая тревога», «тёплая уверенность»). Непонятое не угадываем: провайдер
 * сам выберет интонацию по тексту, а неизвестное значение уронило бы запрос.
 */
const MINIMAX_EMOTIONS = new Set([
  "auto", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "neutral",
])

const MINIMAX_EMOTION_HINTS: Array<{ match: RegExp, emotion: string }> = [
  { match: /радост|восторг|happy|joy/i, emotion: "happy" },
  { match: /груст|печал|sad/i, emotion: "sad" },
  { match: /злост|раздраж|гнев|angry/i, emotion: "angry" },
  { match: /страх|тревог|fear|anxious/i, emotion: "fearful" },
  { match: /удивл|изумл|surprise/i, emotion: "surprised" },
  { match: /спокой|уверен|ясност|calm|confident/i, emotion: "calm" },
]

function normalizeMinimaxEmotion(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase()
  if (!value) return null
  if (MINIMAX_EMOTIONS.has(value)) return value
  return MINIMAX_EMOTION_HINTS.find(hint => hint.match.test(value))?.emotion ?? null
}

/**
 * MiniMax speech-02-turbo на Replicate — основная TTS-модель.
 *
 * Русский произносит на родном уровне, в отличие от Kokoro, у которого русского
 * языка нет вовсе, а эндпоинта `fal-ai/kokoro/russian` не существует (fal отдаёт
 * 404) — проверено живыми вызовами.
 *
 * Голоса задаются собственными идентификаторами MiniMax, а не ISO-кодами, и
 * списка допустимых значений схема модели не публикует — там просто строка.
 * Проверено живыми вызовами: `Wise_Woman` и `Calm_Woman` работают и читают
 * русский, а языковые варианты вроде `Russian_Wiselady` модель отвергает.
 * Женский голос по умолчанию — ведущая в кадре женщина.
 *
 * Цена — $0.06 за 1000 символов, override через
 * REPLICATE_TTS_PRICE_USD_PER_1K_CHARS. `billingConfirmed: false` — canary по
 * `docs/operations/replicate.md` по модели не проводился.
 */
const MINIMAX_SPEECH_02_TURBO: TextToSpeechModelSpec = Object.freeze<TextToSpeechModelSpec>({
  registryKey: "replicate:minimax-speech-02-turbo",
  id: DEFAULT_REPLICATE_TTS_MODEL,
  provider: "replicate",
  capability: "text_to_speech",
  execution: "async_prediction",
  /**
   * Страница модели: «$0.06 per thousand input tokens». Тарифицируются токены,
   * а мы считаем по символам — и для русского это одно и то же.
   *
   * Измерено на оплаченных прогонах 06.08.2026: пять реплик, у всех
   * `token_input_count` в метриках Replicate совпал с длиной текста ровно
   * (113→113, 109→109, 102→102, 99→99, 95→95). Соотношение 1:1, поэтому счёт
   * по символам — не оценка сверху, а точная цена.
   */
  get billing() {
    return {
      unit: "character",
      usdPerCharacter: readReplicatePrice("REPLICATE_TTS_PRICE_USD_PER_1K_CHARS", 0.06) / 1000,
    } as const
  },
  billingConfirmed: true,
  constraints: Object.freeze({
    maxCharacters: 5000,
    languages: Object.freeze(["ru", "en"]),
    formats: Object.freeze(["mp3"]),
  }),
  // Реплика синтезируется секунды, а не минуты, но prediction идёт через очередь
  // Replicate и на занятом аккаунте ждёт своей очереди.
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    const text = requireText(input.text, "text")
    if (text.length > this.constraints.maxCharacters) {
      throw new Error(`Медиавход: реплика длиннее ${this.constraints.maxCharacters} символов для ${this.id}`)
    }
    const language = (input.language || "en").slice(0, 2).toLowerCase()
    if (!this.constraints.languages.includes(language)) {
      throw new Error(`Модель ${this.id} не произносит язык "${language}"`)
    }
    const emotion = normalizeMinimaxEmotion(input.emotion)
    return {
      payload: {
        text,
        // MiniMax принимает темп в 0.5–2. Нормализованный вход приходит из
        // pacing (0.85/1.0/1.15) и в диапазон укладывается, но зажимаем здесь:
        // ограничение провайдера — свойство модели, а не вызывающего.
        speed: Math.min(2, Math.max(0.5, Number.isFinite(input.speed) ? input.speed : 1)),
        voice_id: requireText(input.voiceId, "voiceId"),
        // "Automatic" — значение из enum модели; "auto" она не принимает.
        language_boost: MINIMAX_LANGUAGE_BOOST[language] ?? "Automatic",
        ...(emotion ? { emotion } : {}),
      },
    }
  },
  extractOutput: extractAudioOutput,
  voices: Object.freeze({ default: "Wise_Woman", envOverrideKey: "REPLICATE_TTS_VOICE" }),
  dataProcessor: Object.freeze({
    name: "MiniMax",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "standard",
  name: "MiniMax Speech 02 Turbo",
  vendorLabel: "Replicate / MiniMax",
  strengths: Object.freeze([
    "Родной русский, а не английская модель с русским текстом",
    "Основной провайдер Replicate — тот же контур, что у lip-sync",
    "Идемпотентный синтез: повтор той же реплики не тратит деньги",
  ]),
  tradeoffs: Object.freeze([
    "Голоса задаются идентификаторами MiniMax, а не ISO-кодами",
    "Цена за символ не подтверждена canary",
  ]),
  avgGenerationTime: "~3-8 сек на фразу",
})

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
  // Запись оставлена НЕ подключённой намеренно: эндпоинта не существует, fal
  // отдаёт 404, и русского языка у Kokoro нет вовсе — проверено живыми вызовами.
  // Удалять спеку нельзя: у роликов в БД этот id уже записан в voiceoverModelId,
  // и без неё они падали бы «модель неизвестна» вместо внятного «не подключена».
  // Замена — replicate:minimax-speech-02-turbo.
  integrated: false,
  tier: "budget",
  name: "Kokoro (Russian)",
  vendorLabel: "Hexgrad / fal.ai",
  strengths: Object.freeze([]),
  tradeoffs: Object.freeze([
    "Эндпоинта не существует: fal.ai отдаёт 404, у Kokoro нет русского языка",
  ]),
  avgGenerationTime: "-",
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

// ─── speech_to_video: портрет + речь → говорящее видео ──────────
//
// Схемы всех четырёх моделей сняты с Replicate 14.08.2026 через
// `https://replicate.com/api/models/<owner>/<name>/versions`. Имена полей и
// значения enum — дословные; выход у всех одна строка-URL.
//
// Встроенный TTS `p-video-avatar` (voice_script, voice, voice_language)
// осознанно не используется: голос ведущего задан `voiceoverVoiceId` и
// синтезируется своим маршрутом, подменять его чужим набором нельзя.

const SPEECH_TO_VIDEO_TIMEOUT_MS = 30 * 60 * 1000

/** Ближайшее разрешение из тех, что модель реально принимает. */
function pickResolution(supported: readonly string[], requested: string | undefined): string {
  const normalized = requested?.trim().toLowerCase()
  if (normalized && supported.includes(normalized)) return normalized

  const height = normalized ? Number.parseInt(normalized, 10) : Number.NaN
  if (Number.isFinite(height)) {
    // Просили больше, чем модель умеет — берём её максимум, а не отказываемся:
    // апскейл дешевле, чем потерянная сцена.
    const sorted = [...supported].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    const fit = sorted.filter(value => Number.parseInt(value, 10) <= height).pop()
    return fit ?? sorted[0]!
  }
  return supported[0]!
}

/**
 * Общая проверка входа: портрет, аудио и длительность в пределах модели.
 * Потолок длины проверяется ДО оплаты — узнать о нём после списания денег
 * плохой размен (spec 2026-08-14-avatar-pipeline §3.4).
 */
function requireSpeechToVideoInput(
  input: { imageUrl: string, audioUrl: string, durationSec: number },
  maxDurationSec: number,
  modelLabel: string,
): { image: string, audio: string, durationSec: number } {
  const image = requireText(input.imageUrl, "imageUrl")
  const audio = requireText(input.audioUrl, "audioUrl")
  const durationSec = requirePositive(input.durationSec, "durationSec")
  if (durationSec > maxDurationSec) {
    throw new Error(
      `${modelLabel}: аудио ${durationSec.toFixed(1)}с длиннее потолка модели ${maxDurationSec}с`,
    )
  }
  return { image, audio, durationSec }
}

const PORTRAIT_IMAGE_EXTENSIONS = Object.freeze([".jpg", ".jpeg", ".png", ".webp"])
const SPEECH_AUDIO_EXTENSIONS = Object.freeze([".mp3", ".wav", ".m4a", ".aac"])

/**
 * Pruna p-video-avatar — основной маршрут аватарных сцен.
 *
 * Единственная модель способности с опубликованной ценой: $0.025/с в 720p и
 * $0.045/с в 1080p (страница модели, 14.08.2026). Для сравнения, прежняя связка
 * image_to_video + lip_sync стоила $0.059/с и требовала двух predictions.
 */
const PRUNA_P_VIDEO_AVATAR: SpeechToVideoModelSpec = Object.freeze<SpeechToVideoModelSpec>({
  registryKey: "replicate:p-video-avatar",
  id: "prunaai/p-video-avatar",
  provider: "replicate",
  capability: "speech_to_video",
  execution: "async_prediction",
  billing: {
    unit: "output_second",
    usdPerSecond: 0.025,
    byResolution: Object.freeze({ "720p": 0.025, "1080p": 0.045 }),
  },
  billingConfirmed: true,
  constraints: Object.freeze({
    resolutions: Object.freeze(["720p", "1080p"]),
    // Потолка длины модель не объявляет: длительность равна длине аудио.
    // Держим границу ролика целиком — больше нам и не нужно.
    maxDurationSec: 120,
    audioExtensions: SPEECH_AUDIO_EXTENSIONS,
    imageExtensions: PORTRAIT_IMAGE_EXTENSIONS,
    supportsPrompt: true,
  }),
  timeoutMs: SPEECH_TO_VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const { image, audio, durationSec } = requireSpeechToVideoInput(input, 120, "p-video-avatar")
    return {
      payload: {
        image,
        audio,
        resolution: pickResolution(["720p", "1080p"], input.resolution),
        ...(input.prompt?.trim() ? { video_prompt: input.prompt.trim() } : {}),
        ...(input.negativePrompt?.trim() ? { negative_prompt: input.negativePrompt.trim() } : {}),
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
      effectiveDurationSec: durationSec,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: Object.freeze({
    name: "Pruna AI",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "standard",
  name: "Pruna Avatar (Replicate)",
  vendorLabel: "Replicate / Pruna AI",
  strengths: Object.freeze([
    "Мимика и движения выведены из речи, а не сгенерированы отдельно",
    "Один платный вызов вместо image-to-video плюс lip-sync",
    "Цена подтверждена страницей модели: $0.025/с в 720p",
  ]),
  tradeoffs: Object.freeze([
    "Русская артикуляция не проверена canary",
    "Требует фронтального портрета: ракурс и перекрытия ломают идентичность",
  ]),
  avgGenerationTime: "2-6 мин",
})

/**
 * VEED Fabric 1.0 — маршрут длинных блоков.
 *
 * Держит 60 секунд одним куском, то есть ролик 70-90 секунд собирается двумя
 * вызовами вместо девяти. Цена не опубликована, поэтому `integrated: false`:
 * пускать в смету модель с выдуманным тарифом нельзя (§7 п.2 спецификации).
 * Принимает только image, audio и resolution — промпта у модели нет.
 */
const VEED_FABRIC_1: SpeechToVideoModelSpec = Object.freeze<SpeechToVideoModelSpec>({
  registryKey: "replicate:veed-fabric-1",
  id: "veed/fabric-1.0",
  provider: "replicate",
  capability: "speech_to_video",
  execution: "async_prediction",
  // $0.08 за секунду выхода — со страницы модели 16.08.2026. Прежние $0.025
  // были прикидкой и занижали смету втрое.
  billing: { unit: "output_second", usdPerSecond: 0.08 },
  billingConfirmed: true,
  constraints: Object.freeze({
    resolutions: Object.freeze(["480p", "720p"]),
    maxDurationSec: 60,
    audioExtensions: SPEECH_AUDIO_EXTENSIONS,
    imageExtensions: Object.freeze([".jpg", ".jpeg", ".png"]),
    supportsPrompt: false,
  }),
  timeoutMs: SPEECH_TO_VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const { image, audio, durationSec } = requireSpeechToVideoInput(input, 60, "fabric-1.0")
    return {
      payload: {
        image,
        audio,
        resolution: pickResolution(["480p", "720p"], input.resolution),
      },
      effectiveDurationSec: durationSec,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: Object.freeze({
    name: "VEED",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: false,
  tier: "standard",
  name: "VEED Fabric 1.0",
  vendorLabel: "Replicate / VEED",
  strengths: Object.freeze([
    "60 секунд одним вызовом — ролик собирается блоками, а не девятью сценами",
  ]),
  tradeoffs: Object.freeze([
    "Цена не опубликована — до подтверждения не включается",
    "Максимум 720p",
    "Промпта нет: поведение в кадре не задаётся",
  ]),
  avgGenerationTime: "3-8 мин",
})

/**
 * ByteDance OmniHuman — принимает портрет, поясной и ростовой кадр.
 *
 * Схема минимальная: image и audio, оба обязательны. Цена не опубликована,
 * поэтому модель лежит выключенной.
 */
const BYTEDANCE_OMNI_HUMAN: SpeechToVideoModelSpec = Object.freeze<SpeechToVideoModelSpec>({
  registryKey: "replicate:omni-human",
  id: "bytedance/omni-human",
  provider: "replicate",
  capability: "speech_to_video",
  execution: "async_prediction",
  // $0.14 за секунду выхода — со страницы модели 16.08.2026. Прежние $0.045
  // занижали смету втрое: сцена ведущей на 8.5 с стоит $1.19, а не $0.38.
  billing: { unit: "output_second", usdPerSecond: 0.14 },
  billingConfirmed: true,
  constraints: Object.freeze({
    resolutions: Object.freeze(["720p"]),
    maxDurationSec: 60,
    audioExtensions: SPEECH_AUDIO_EXTENSIONS,
    imageExtensions: PORTRAIT_IMAGE_EXTENSIONS,
    supportsPrompt: false,
  }),
  timeoutMs: SPEECH_TO_VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const { image, audio, durationSec } = requireSpeechToVideoInput(input, 60, "omni-human")
    return {
      // Схема модели знает ровно два поля. Лишнее не отправляем: Replicate
      // отвергает неизвестные ключи, а платит за отказ всё равно вызывающий.
      payload: { image, audio },
      effectiveDurationSec: durationSec,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: Object.freeze({
    name: "ByteDance",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: false,
  tier: "premium",
  name: "OmniHuman (Replicate)",
  vendorLabel: "Replicate / ByteDance",
  strengths: Object.freeze([
    "Работает с портретом, поясным и ростовым кадром",
    "Жестикуляция телом, а не только мимика",
  ]),
  tradeoffs: Object.freeze([
    "Цена не опубликована — до подтверждения не включается",
    "Ни промпта, ни выбора разрешения",
  ]),
  avgGenerationTime: "5-15 мин",
})

/**
 * Kling Avatar v2 — портрет плюс речь, естественные повороты и кивки головы.
 *
 * По сравнительным обзорам 2026 идёт следом за OmniHuman по точности губ, но
 * втрое дешевле его ($0.056 против $0.14 за секунду) и не разваливается на
 * длинных сценах — у OmniHuman отмечают деградацию кадра после 10-11 секунд,
 * а наши сцены как раз 8-10.
 */
const KLING_AVATAR_V2: SpeechToVideoModelSpec = Object.freeze<SpeechToVideoModelSpec>({
  registryKey: "replicate:kling-avatar-v2",
  id: "kwaivgi/kling-avatar-v2",
  provider: "replicate",
  capability: "speech_to_video",
  execution: "async_prediction",
  billing: { unit: "output_second", usdPerSecond: 0.056 },
  billingConfirmed: true,
  constraints: Object.freeze({
    resolutions: Object.freeze(["720p", "1080p"]),
    maxDurationSec: 60,
    audioExtensions: SPEECH_AUDIO_EXTENSIONS,
    imageExtensions: PORTRAIT_IMAGE_EXTENSIONS,
    supportsPrompt: false,
  }),
  timeoutMs: SPEECH_TO_VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const { image, audio, durationSec } = requireSpeechToVideoInput(input, 60, "kling-avatar-v2")
    return {
      payload: { image, audio },
      effectiveDurationSec: durationSec,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: Object.freeze({
    name: "Kuaishou",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "premium",
  name: "Kling Avatar v2",
  vendorLabel: "Replicate / Kuaishou",
  strengths: Object.freeze([
    "Естественные повороты и кивки головы, а не одни губы",
    "Держит длинную сцену без деградации кадра",
    "Кадрирование задаёт портрет — крупный план вместо общего",
  ]),
  tradeoffs: Object.freeze([
    "Дороже липсинка по живому видео вчетверо",
    "Фон и одежда берутся с портрета: смена плана внутри сцены невозможна",
  ]),
  avgGenerationTime: "3-8 мин",
})

/**
 * Sync Labs Lipsync 2.0 — липсинк по ГОТОВОМУ видео, как и Kling Lip Sync,
 * но заметно точнее на фронтальной съёмке. В обзорах UGC-рекламы 2026 стоит в
 * категории «фиксеров» рядом с 2-pro; про 2-pro отдельно отмечают, что он
 * вязнет на статичных кадрах и сложных ракурсах.
 */
const SYNC_LIPSYNC_2: LipSyncModelSpec = Object.freeze<LipSyncModelSpec>({
  registryKey: "replicate:sync-lipsync-2",
  id: "sync/lipsync-2",
  provider: "replicate",
  capability: "lip_sync",
  execution: "async_prediction",
  billing: { unit: "output_second", usdPerSecond: 0.05 },
  billingConfirmed: true,
  constraints: LIP_SYNC_CONSTRAINTS,
  timeoutMs: 15 * 60_000,
  mapInput(input) {
    return {
      payload: {
        video: requireText(input.videoUrl, "videoUrl"),
        audio: requireText(input.audioUrl, "audioUrl"),
        sync_mode: "cut_off",
      },
    }
  },
  extractOutput(raw) {
    return extractMediaOutput(raw, { priorityKeys: ["video"], defaultContentType: "video/mp4" })
  },
  dataProcessor: Object.freeze({
    name: "Sync Labs",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "premium",
  name: "Sync Lipsync 2.0",
  vendorLabel: "Replicate / Sync Labs",
  strengths: Object.freeze([
    "Точнее бюджетного Kling Lip Sync на фронтальной съёмке",
    "Работает по готовому видео — живой материал остаётся живым",
  ]),
  tradeoffs: Object.freeze([
    "Втрое дороже Kling Lip Sync",
    "Общий план и сложный ракурс остаются проблемой — рот мал в кадре",
  ]),
  avgGenerationTime: "~1-3 мин на сцену",
})

/** Sync Labs Lipsync 2 Pro — та же схема, студийное качество, вдвое дороже 2.0. */
const SYNC_LIPSYNC_2_PRO: LipSyncModelSpec = Object.freeze<LipSyncModelSpec>({
  ...SYNC_LIPSYNC_2,
  registryKey: "replicate:sync-lipsync-2-pro",
  id: "sync/lipsync-2-pro",
  billing: { unit: "output_second", usdPerSecond: 0.08325 },
  tier: "premium",
  name: "Sync Lipsync 2 Pro",
  tradeoffs: Object.freeze([
    "Дороже Kling Lip Sync в шесть раз",
    "По обзорам вязнет на статичных кадрах и сложных ракурсах",
  ]),
})

/**
 * Wan 2.2 S2V — единственная в способности, где промпт обязателен по схеме.
 *
 * Тарифицировалась у нас временем GPU (300 секунд по $0.001 — фиксированные
 * $0.30 за прогон независимо от длины сцены). На странице модели 16.08.2026
 * стоит другая единица: $0.02 за секунду ВЫХОДА. Для сцены в 8.5 с это $0.17
 * вместо $0.30, а для минутного блока — $1.20 вместо тех же $0.30.
 */
const WAN_22_S2V: SpeechToVideoModelSpec = Object.freeze<SpeechToVideoModelSpec>({
  registryKey: "replicate:wan-2.2-s2v",
  id: "wan-video/wan-2.2-s2v",
  provider: "replicate",
  capability: "speech_to_video",
  execution: "async_prediction",
  billing: { unit: "output_second", usdPerSecond: 0.02 },
  billingConfirmed: true,
  constraints: Object.freeze({
    resolutions: Object.freeze(["480p", "720p"]),
    maxDurationSec: 60,
    audioExtensions: SPEECH_AUDIO_EXTENSIONS,
    imageExtensions: PORTRAIT_IMAGE_EXTENSIONS,
    supportsPrompt: true,
  }),
  timeoutMs: SPEECH_TO_VIDEO_TIMEOUT_MS,
  mapInput(input) {
    const { image, audio, durationSec } = requireSpeechToVideoInput(input, 60, "wan-2.2-s2v")
    return {
      payload: {
        image,
        audio,
        // Промпт обязателен по схеме модели. Пустая строка — не вариант:
        // модель получит задание «ничего» и снимет что угодно.
        prompt: input.prompt?.trim()
          || "a person speaking to the camera, natural expression, static framing",
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
      effectiveDurationSec: durationSec,
    }
  },
  extractOutput: extractVideoOutput,
  dataProcessor: Object.freeze({
    name: "Alibaba Wan",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: false,
  tier: "standard",
  name: "Wan 2.2 S2V (Replicate)",
  vendorLabel: "Replicate / Alibaba",
  strengths: Object.freeze([
    "Поведение в кадре задаётся промптом",
    "Открытые веса, воспроизводимость по seed",
  ]),
  tradeoffs: Object.freeze([
    "Тариф по времени GPU: точная цена известна только после прогона",
    "480p/720p, 24 кадра в секунду",
  ]),
  avgGenerationTime: "5-15 мин",
})

// ─── image_to_image: референс + инструкция → тот же человек ─────
//
// Схемы сняты с Replicate 14.08.2026 через
// `https://replicate.com/api/models/<owner>/<name>/versions`, цены — из
// `billingConfig` страницы модели (`https://replicate.com/<owner>/<name>`).
// Публичный API тарифы не отдаёт вовсе, а страница отдаёт: у трёх Kontext это
// per-unit `image_output_count`, у pulid цены нет — только оценка прогона.

const KONTEXT_IMAGE_EXTENSIONS = Object.freeze([".jpg", ".jpeg", ".png", ".gif", ".webp"])

/** Пропорции Kontext pro/max — дословно enum `aspect_ratio` их схемы. */
const KONTEXT_PRO_ASPECT_RATIOS = Object.freeze([
  "match_input_image", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3",
  "4:5", "5:4", "21:9", "9:21", "2:1", "1:2",
])

/** У dev тот же набор, но в другом порядке — берём из его собственной схемы. */
const KONTEXT_DEV_ASPECT_RATIOS = Object.freeze([
  "1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3",
  "9:16", "9:21", "match_input_image",
])

/**
 * Пропорция кадра для Kontext. Размер не задан — `match_input_image`: у правки
 * портрета нет причин менять кадрирование, а насильная пропорция обрежет лицо.
 */
function pickKontextAspectRatio(
  supported: readonly string[],
  width: number | undefined,
  height: number | undefined,
): string {
  if (!width || !height) return "match_input_image"
  return pickAspectRatio(supported.filter(value => value !== "match_input_image"), width, height)
}

function requireEditInstruction(input: { imageUrl: string, prompt: string, count: number }, max: number) {
  assertImageCount(input.count, max)
  return {
    image: requireText(input.imageUrl, "imageUrl"),
    prompt: requireText(input.prompt, "prompt"),
  }
}

/**
 * FLUX.1 Kontext [dev] — основной маршрут вариаций портрета.
 *
 * Самый дешёвый из трёх ($0.025 за кадр против $0.04 у pro и $0.08 у max) и
 * единственный, у кого `input_image` обязателен по схеме, — то есть модель
 * заточена ровно под нашу задачу: правку существующего кадра, а не рисование
 * с нуля. Цена подтверждена страницей модели 14.08.2026.
 */
const FLUX_KONTEXT_DEV: ImageToImageModelSpec = Object.freeze<ImageToImageModelSpec>({
  registryKey: "replicate:flux-kontext-dev",
  id: "black-forest-labs/flux-kontext-dev",
  provider: "replicate",
  capability: "image_to_image",
  execution: "async_prediction",
  billing: { unit: "output_image", usdPerImage: 0.025 },
  billingConfirmed: true,
  constraints: Object.freeze({
    aspectRatios: KONTEXT_DEV_ASPECT_RATIOS,
    maxImagesPerRequest: 1,
    inputImageExtensions: KONTEXT_IMAGE_EXTENSIONS,
    preservesIdentity: true,
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    const { image, prompt } = requireEditInstruction(input, this.constraints.maxImagesPerRequest)
    return {
      payload: {
        prompt,
        input_image: image,
        aspect_ratio: pickKontextAspectRatio(this.constraints.aspectRatios, input.width, input.height),
        output_format: "jpg",
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    }
  },
  extractOutput: extractImageOutput,
  dataProcessor: Object.freeze({
    name: "Black Forest Labs",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "standard",
  name: "FLUX.1 Kontext [dev]",
  vendorLabel: "Replicate / Black Forest Labs",
  strengths: Object.freeze([
    "Правка кадра инструкцией: лицо сохраняется, меняются ракурс, одежда и фон",
    "$0.025 за кадр — цена подтверждена страницей модели",
    "Открытые веса, воспроизводимость по seed",
  ]),
  tradeoffs: Object.freeze([
    "Один кадр за вызов: пачка вариаций — это пачка predictions",
    "Сложные правки держит хуже pro и max",
  ]),
  avgGenerationTime: "~15 сек",
})

/**
 * FLUX.1 Kontext [pro] — когда dev не удержал человека.
 *
 * Схема отличается от dev: нет guidance и num_inference_steps, зато есть
 * safety_tolerance и prompt_upsampling. Апсемплинг не включаем — он переписывает
 * инструкцию, а мы просим сохранить конкретного человека.
 */
const FLUX_KONTEXT_PRO: ImageToImageModelSpec = Object.freeze<ImageToImageModelSpec>({
  registryKey: "replicate:flux-kontext-pro",
  id: "black-forest-labs/flux-kontext-pro",
  provider: "replicate",
  capability: "image_to_image",
  execution: "async_prediction",
  billing: { unit: "output_image", usdPerImage: 0.04 },
  billingConfirmed: true,
  constraints: Object.freeze({
    aspectRatios: KONTEXT_PRO_ASPECT_RATIOS,
    maxImagesPerRequest: 1,
    inputImageExtensions: KONTEXT_IMAGE_EXTENSIONS,
    preservesIdentity: true,
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    const { image, prompt } = requireEditInstruction(input, this.constraints.maxImagesPerRequest)
    return {
      payload: {
        prompt,
        input_image: image,
        aspect_ratio: pickKontextAspectRatio(this.constraints.aspectRatios, input.width, input.height),
        output_format: "jpg",
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    }
  },
  extractOutput: extractImageOutput,
  dataProcessor: Object.freeze({
    name: "Black Forest Labs",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "premium",
  name: "FLUX.1 Kontext [pro]",
  vendorLabel: "Replicate / Black Forest Labs",
  strengths: Object.freeze([
    "Держит идентичность на сложных правках лучше dev",
    "Цена подтверждена страницей модели: $0.04 за кадр",
  ]),
  tradeoffs: Object.freeze([
    "В 1.6 раза дороже dev",
    "Веса закрыты: только через провайдера",
  ]),
  avgGenerationTime: "~20 сек",
})

/** FLUX.1 Kontext [max] — та же схема, что у pro, вдвое дороже. */
const FLUX_KONTEXT_MAX: ImageToImageModelSpec = Object.freeze<ImageToImageModelSpec>({
  registryKey: "replicate:flux-kontext-max",
  id: "black-forest-labs/flux-kontext-max",
  provider: "replicate",
  capability: "image_to_image",
  execution: "async_prediction",
  billing: { unit: "output_image", usdPerImage: 0.08 },
  billingConfirmed: true,
  constraints: Object.freeze({
    aspectRatios: KONTEXT_PRO_ASPECT_RATIOS,
    maxImagesPerRequest: 1,
    inputImageExtensions: KONTEXT_IMAGE_EXTENSIONS,
    preservesIdentity: true,
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    const { image, prompt } = requireEditInstruction(input, this.constraints.maxImagesPerRequest)
    return {
      payload: {
        prompt,
        input_image: image,
        aspect_ratio: pickKontextAspectRatio(this.constraints.aspectRatios, input.width, input.height),
        output_format: "jpg",
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    }
  },
  extractOutput: extractImageOutput,
  dataProcessor: Object.freeze({
    name: "Black Forest Labs",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: true,
  tier: "premium",
  name: "FLUX.1 Kontext [max]",
  vendorLabel: "Replicate / Black Forest Labs",
  strengths: Object.freeze([
    "Самое точное следование инструкции правки из трёх Kontext",
    "Цена подтверждена страницей модели: $0.08 за кадр",
  ]),
  tradeoffs: Object.freeze([
    "Вдвое дороже pro и втрое дороже dev",
  ]),
  avgGenerationTime: "~25 сек",
})

/** Границы кадра pulid из его схемы: width и height от 256 до 1536. */
const PULID_MIN_SIDE = 256
const PULID_MAX_SIDE = 1536

/**
 * Кадр в границах модели с сохранением пропорции.
 *
 * Обрезать по стороне нельзя: 1080x1920 превратилось бы в 1080x1536, то есть в
 * другое кадрирование, и портрет уехал бы за край. Масштабируем целиком.
 */
function fitPulidFrame(width: number, height: number): { width: number, height: number } {
  const scale = Math.min(1, PULID_MAX_SIDE / Math.max(width, height))
  const scaled = {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
  return {
    width: Math.min(PULID_MAX_SIDE, Math.max(PULID_MIN_SIDE, scaled.width)),
    height: Math.min(PULID_MAX_SIDE, Math.max(PULID_MIN_SIDE, scaled.height)),
  }
}

/**
 * PuLID для FLUX — другой механизм: не правка кадра, а генерация нового
 * изображения по лицу с референса. Полезен там, где Kontext упирается в
 * «переставить того же человека в другую сцену целиком».
 *
 * Тарифицируется временем GPU (A100 80GB). Страница модели даёт только оценку
 * прогона (≈$0.021), а оценка — не тариф: модель лежит выключенной, пока цену
 * не подтвердят счётом аккаунта (§7 п.2 спецификации).
 */
const BYTEDANCE_FLUX_PULID: ImageToImageModelSpec = Object.freeze<ImageToImageModelSpec>({
  registryKey: "replicate:flux-pulid",
  id: "bytedance/flux-pulid",
  provider: "replicate",
  capability: "image_to_image",
  execution: "async_prediction",
  billing: { unit: "hardware_second", usdPerSecond: 0.0014, estimatedSeconds: 15 },
  billingConfirmed: false,
  constraints: Object.freeze({
    // Пропорции задаются width/height, отдельного enum у модели нет.
    aspectRatios: Object.freeze([]),
    maxImagesPerRequest: 1,
    inputImageExtensions: KONTEXT_IMAGE_EXTENSIONS,
    preservesIdentity: true,
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    const { image, prompt } = requireEditInstruction(input, this.constraints.maxImagesPerRequest)
    const frame = fitPulidFrame(input.width ?? 896, input.height ?? 1152)
    return {
      payload: {
        main_face_image: image,
        prompt,
        width: frame.width,
        height: frame.height,
        num_outputs: input.count,
        output_format: "jpg",
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    }
  },
  extractOutput: extractImageOutput,
  dataProcessor: Object.freeze({
    name: "ByteDance",
    note: "Replicate sends this model's inputs to the model provider for processing.",
  }),
  integrated: false,
  tier: "standard",
  name: "FLUX PuLID",
  vendorLabel: "Replicate / ByteDance",
  strengths: Object.freeze([
    "Переносит лицо в новую сцену целиком, а не правит исходный кадр",
    "Сила сходства регулируется (id_weight)",
  ]),
  tradeoffs: Object.freeze([
    "Тариф по времени GPU: точная цена известна только после прогона",
    "Кадр не больше 1536 по стороне",
  ]),
  avgGenerationTime: "~15 сек",
})

// ─── Fish Audio: третий провайдер, третий транспорт ─────────────
//
// Взят ради двух измеренных вещей: на русском вдвое дешевле MiniMax
// ($0.03 против $0.06 за 1000 символов) и звучит живее — сравнивали на одной
// реплике голосом ведущей.
//
// Транспорт отличается от обоих прежних: Replicate отдаёт prediction, fal —
// ссылку на выход, Fish — БАЙТЫ аудио прямо в теле ответа. Отсюда
// `execution: "sync_bytes"`.
//
// Схема снята с `https://api.fish.audio/openapi.json` 15.08.2026:
//   POST /v1/tts, обязателен только `text`; модель выбирается ЗАГОЛОВКОМ
//   `model`; голос — `reference_id`; темп — `prosody.speed` (0.5–2.0).
// Поля языка в схеме НЕТ: модель определяет его сама.

const FISH_LANGUAGES = Object.freeze(["en", "ru", "de", "fr", "es", "it", "pt", "pl", "zh", "ja", "ko"])
const FISH_SPEED_RANGE = Object.freeze([0.5, 2] as const)

/** Аудио приходит байтами — разбирать ссылку нечего. */
function extractFishOutput() {
  return { urls: [] as string[], contentType: "audio/mpeg" }
}

function mapFishInput(
  input: { text: string, voiceId: string, speed: number },
  maxCharacters: number,
) {
  const text = requireText(input.text, "text")
  if (text.length > maxCharacters) {
    throw new Error(`Fish Audio: текст ${text.length} символов, предел тарифа ${maxCharacters}`)
  }
  const speed = Math.min(FISH_SPEED_RANGE[1], Math.max(FISH_SPEED_RANGE[0], input.speed))
  return {
    payload: {
      text,
      reference_id: requireText(input.voiceId, "voiceId"),
      format: "mp3",
      mp3_bitrate: 128,
      prosody: { speed },
    },
  }
}

/**
 * S2.1 Pro в бесплатном режиме. Работает без пополнения API-кошелька —
 * проверено прогоном 15.08.2026, когда платные модели отвечали 402
 * «Insufficient API credit» (кошелёк API у них отдельный от тарифа платформы).
 *
 * Предел 500 символов на генерацию — с бесплатного тарифа их страницы цен.
 * Реплика сцены в него укладывается с запасом.
 */
const FISH_S21_PRO_FREE: TextToSpeechModelSpec = Object.freeze<TextToSpeechModelSpec>({
  registryKey: "fish:s2.1-pro-free",
  id: "s2.1-pro-free",
  provider: "fish",
  capability: "text_to_speech",
  execution: "sync_bytes",
  billing: { unit: "flat", usd: 0 },
  billingConfirmed: true,
  constraints: Object.freeze({
    maxCharacters: 500,
    languages: FISH_LANGUAGES,
    formats: Object.freeze(["mp3"]),
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    return mapFishInput(input, this.constraints.maxCharacters)
  },
  extractOutput: extractFishOutput,
  dataProcessor: Object.freeze({
    name: "Fish Audio",
    note: "Текст и голосовая модель обрабатываются на стороне Fish Audio.",
  }),
  integrated: true,
  tier: "budget",
  name: "Fish Audio S2.1 Pro (free)",
  vendorLabel: "Fish Audio",
  strengths: Object.freeze([
    "Бесплатно: платит только за клонирование голоса, синтез ноль",
    "Живее MiniMax на русском — сравнивали на одной реплике",
    "Знак ударения U+0301 отрабатывает",
  ]),
  tradeoffs: Object.freeze([
    "500 символов за генерацию",
    "Третий провайдер в контуре: свой ключ и своя точка отказа",
  ]),
  avgGenerationTime: "~3 сек",
})

/**
 * S2.1 Pro платный. Тариф $15 за 1 млн UTF-8 БАЙТ; кириллица это два байта на
 * букву, то есть $0.03 за 1000 русских символов.
 *
 * `integrated: true` — API-кошелёк Fish пополнен (подтверждено владельцем
 * 27.08.2026), причина отказа 402 отпала. Модель обязательна для маршрута
 * «монтаж от звука»: у бесплатной `s2.1-pro-free` предел 500 символов на
 * вызов, а этот маршрут синтезирует один трек на весь сценарий (1200+
 * символов) — с бесплатной моделью голос Лианы там был физически недоступен,
 * и ролик озвучивался чужим дефолтным голосом.
 *
 * `billingConfirmed: false` остаётся — это ДРУГОЙ флаг, и пополненный
 * кошелёк его не закрывает: официальная страница тарифов
 * (`fish.audio/pricing`, `fish.audio/go-api/pricing/`) по-прежнему отдаёт 404
 * (перепроверено 27.08.2026), число $15/1M байт взято из обзоров. Тариф
 * подлежит подтверждению по §14 `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md`
 * при первой возможности (снять со страницы модели, как остальные тарифы
 * Replicate) — до этого он живёт как «лучшая известная оценка», а не факт.
 */
const FISH_S21_PRO: TextToSpeechModelSpec = Object.freeze<TextToSpeechModelSpec>({
  registryKey: "fish:s2.1-pro",
  id: "s2.1-pro",
  provider: "fish",
  capability: "text_to_speech",
  execution: "sync_bytes",
  billing: { unit: "utf8_byte", usdPerByte: 15 / 1_000_000 },
  billingConfirmed: false,
  constraints: Object.freeze({
    // Предел тарифа Plus с их страницы цен, не документированный предел API.
    maxCharacters: 15000,
    languages: FISH_LANGUAGES,
    formats: Object.freeze(["mp3"]),
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    return mapFishInput(input, this.constraints.maxCharacters)
  },
  extractOutput: extractFishOutput,
  dataProcessor: Object.freeze({
    name: "Fish Audio",
    note: "Текст и голосовая модель обрабатываются на стороне Fish Audio.",
  }),
  integrated: true,
  tier: "standard",
  name: "Fish Audio S2.1 Pro",
  vendorLabel: "Fish Audio",
  strengths: Object.freeze([
    "Вдвое дешевле MiniMax на русском: $0.03 против $0.06 за 1000 символов",
    "Без предела в 500 символов — единственный вариант для одного трека на весь сценарий",
  ]),
  tradeoffs: Object.freeze([
    "Цена из обзоров, а не со страницы модели: billingConfirmed остаётся false",
    "Третий провайдер в контуре: свой ключ и своя точка отказа",
  ]),
  avgGenerationTime: "~3 сек",
})

// ─── transcription: границы слов нашей же озвучки ────────────────

/**
 * Whisper на Replicate. Тариф подтверждён страницей модели
 * (https://replicate.com/openai/whisper, 24.08.2026 — §14 спеки
 * 2026-08-16-audio-first-editing-design): «This model costs approximately
 * $0.0048 to run on Replicate, or 208 runs per $1». Плата берётся ЗА ВРЕМЯ
 * GPU, а не за длину аудио: модель работает на Nvidia T4 ($0.000225/с по
 * тарифу Replicate за это железо), типичное время выполнения — около 22с.
 * 0.000225 × 22 ≈ $0.00495 — сходится с «approximately $0.0048» страницы
 * (расхождение объясняется тем, что «~22с» само округлено).
 *
 * `integrated: false` остаётся ОСОЗНАННО — этим фиксом НЕ снимается: по §4.1
 * спеки маршрут включается на стенде явной переменной MEDIA_MODEL_TRANSCRIPTION,
 * и при заданной модели реестр проверку `integrated` не делает, так путь
 * остаётся обратимым.
 *
 * `openai/whisper` — COMMUNITY-модель, не официальная (страница модели без
 * пометки «Official model»). Канарейка 26.08.2026 упала на этом факте:
 * раннер бил по эндпоинту официальных моделей
 * (`POST /v1/models/openai/whisper/predictions`), а он для community отвечает
 * 404 — путь есть только у официальных моделей вроде
 * `minimax/speech-02-turbo`. Community-модель адресуется через
 * `POST /v1/predictions` с телом `{ version, input }`, поэтому `providerVersion`
 * ниже обязателен для этой спеки (см. `runReplicateJsonModel`).
 *
 * `providerVersion` подтверждён 26.08.2026 через
 * `https://replicate.com/api/models/openai/whisper/versions` (публичный,
 * без токена, тот же способ, каким сняты схемы speech_to_video выше): это
 * ПОСЛЕДНЯЯ из 13 версий модели, `created_at` 2024-11-26. Хеш, изначально
 * предложенный в задаче на этот фикс, оказался РЕАЛЬНЫМ, но УСТАРЕВШИМ —
 * версия от 2024-07-01, на три релиза раньше текущей; используется хеш из
 * прямой проверки, а не из задачи. Пиннинг версии — не только обход 404, но и
 * детерминизм: тот же довод, что у `EditProfile.llmModelId` в спеке монтажа —
 * поведение модели не должно меняться под ногами вслед за новым релизом.
 *
 * ОКОНЧАТЕЛЬНО ПОДТВЕРЖДЕНО 26.08.2026 (canary «монтаж от звука», см.
 * `.superpowers/sdd/2026-08-24-shot-assembly/whisper-version-report.md` и
 * `whisperx-report.md` рядом): схема входа ПОСЛЕДНЕЙ версии (`8099696689d2…`)
 * поля `word_timestamps` НЕ СОДЕРЖИТ вовсе — вход это `audio`, `language`,
 * `patience`, `translate`, `temperature`, `transcription` (enum "plain text" /
 * "srt" / "vtt"), `initial_prompt` и ещё шесть параметров сэмплирования; выход
 * — `segments`, `transcription`, `detected_language`, а не `chunks`, и поля
 * пословных таймингов в выходе тоже нет. Это не «пока не проверено» — это
 * СНЯТЫЙ ФАКТ модели: `openai/whisper` на Replicate пословных таймингов не
 * отдаёт НИКАК, ни при каком входе. Маршрут «монтаж от звука» требует их
 * обязательно (spec §4.1) — эта модель для него НЕПРИГОДНА.
 *
 * Спека остаётся в реестре намеренно: знание о непригодности добыто дорого
 * (упавшим платным canary-прогоном), терять его нельзя — удаление спеки
 * стёрло бы и докстринг с этим фактом, и защиту от повторного изобретения той
 * же ошибки. Замена для маршрута — `REPLICATE_WHISPERX` ниже
 * (`replicate:whisperx`, модель `victor-upmeet/whisperx`): у неё
 * `align_output` дословно из схемы описан как «Aligns whisper output to get
 * accurate word-level timestamps», и это подтверждено не только схемой, но и
 * исходным кодом обёртки (см. докстринг `REPLICATE_WHISPERX`).
 */
const REPLICATE_WHISPER: TranscriptionModelSpec = Object.freeze<TranscriptionModelSpec>({
  registryKey: "replicate:whisper",
  id: "openai/whisper",
  // Последняя версия модели на Replicate (created_at 2024-11-26 из 13 версий,
  // сверено 26.08.2026 — см. докстринг выше). Community-модель без неё
  // недоступна: `runReplicateJsonModel` без `providerVersion` бьёт по пути
  // официальных моделей и получает 404.
  providerVersion: "8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e",
  provider: "replicate",
  capability: "transcription",
  execution: "sync_json",
  billing: { unit: "hardware_second", usdPerSecond: 0.000225, estimatedSeconds: 22 },
  billingConfirmed: true,
  constraints: Object.freeze({
    languages: Object.freeze(["ru", "en"]),
    maxDurationSec: 600,
    audioExtensions: Object.freeze(["mp3", "wav", "m4a"]),
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    const audioUrl = requireText(input.audioUrl, "audioUrl")
    const language = (input.language || "ru").slice(0, 2).toLowerCase()
    if (!this.constraints.languages.includes(language)) {
      throw new Error(`Модель ${this.id} не размечает язык "${language}"`)
    }
    return {
      payload: {
        audio: audioUrl,
        language,
        // Без границ слов транскрипт бесполезен: ради них всё и затевается.
        word_timestamps: true,
      },
    }
  },
  // Выход способности — JSON, а не ссылка на файл: скачивать нечего, разбирает
  // его `normalizeTranscriptPayload`.
  extractOutput: () => ({ urls: [] }),
  dataProcessor: null,
  integrated: false,
  tier: "budget",
  name: "Whisper",
  vendorLabel: "Replicate / OpenAI",
  strengths: Object.freeze([
    "Текст распознаёт корректно, включая русский без отдельной настройки",
  ]),
  tradeoffs: Object.freeze([
    "НЕПРИГОДНА для маршрута «монтаж от звука»: пословных таймингов не отдаёт вовсе — используйте replicate:whisperx",
    "Схема ПОСЛЕДНЕЙ версии подтверждена: поля word_timestamps нет ни на входе, ни на выходе (`segments`/`transcription`, а не `chunks`)",
    "Community-модель: адресуется хешем версии (providerVersion), а не именем",
    "integrated=false до включения на стенде переменной MEDIA_MODEL_TRANSCRIPTION",
  ]),
  avgGenerationTime: "~10-30 сек на ролик",
})

/**
 * WhisperX на Replicate — модель с ПОДТВЕРЖДЁННЫМИ пословными таймингами.
 *
 * Заведена вместо `openai/whisper`: та модель (докстринг выше) вообще не
 * отдаёт границ слов, и маршрут «монтаж от звука» без них не собирает ни
 * одной сцены ведущего (canary 26.08.2026, риск §4.1/§10 спеки
 * 2026-08-16-audio-first-editing-design). У WhisperX это штатная
 * возможность: булево поле `align_output` дословно из схемы описано как
 * «Aligns whisper output to get accurate word-level timestamps».
 *
 * Все факты ниже сверены НАПРЯМУЮ 26.08.2026, тем же публичным способом, что
 * и у `openai/whisper` (без токена, без платных вызовов):
 *
 *  - ВЕРСИЯ: `https://replicate.com/api/models/victor-upmeet/whisperx/versions`
 *    отдал 25 версий; ПОСЛЕДНЯЯ — `655845d6190ef70573c669245f245892cd039df4b880a1e3a65852c09252f5cc`,
 *    `created_at` `2026-05-13T14:42:02Z` (следующая по свежести — от
 *    2024-08-30, то есть это не случайный элемент списка, а настоящий разрыв
 *    во времени между релизами);
 *  - СХЕМА ВХОДА: `_extras.dereferenced_openapi_schema` той же версии,
 *    `paths./predictions.post` → `requestBody...Input`. Обязателен только
 *    `audio_file` (`type: string, format: uri`). Остальное — опции с
 *    дефолтами: `language` (nullable-строка, без enum, "specify None to
 *    perform language detection"), `task` (enum transcribe/translate,
 *    default transcribe), `align_output` (boolean, default FALSE — то есть
 *    её обязательно включать явно), `diarization` (boolean, default false,
 *    требует `huggingface_access_token` — не задаём, диаризация не нужна),
 *    `batch_size`, `temperature`, `vad_onset`, `vad_offset` и ещё несколько
 *    полей — с безопасными дефолтами, не отправляем;
 *  - СХЕМА ВЫХОДА: та же секция, `Output` → `{ segments: object (без
 *    дальнейшей расшифровки — Cog не разворачивает вложенный объект в
 *    OpenAPI), detected_language: string }`;
 *  - ФОРМА `segments` ПРИ `align_output: true` — раз OpenAPI её не
 *    раскрывает, взята из ИСХОДНОГО КОДА, а не угадана: репозиторий
 *    `victor-upmeet/whisperx-replicate` (GitHub, публичный,
 *    `raw.githubusercontent.com/victor-upmeet/whisperx-replicate/main/predict.py`)
 *    возвращает `Output(segments=result["segments"], ...)`, где при
 *    `align_output=True` `result = whisperx.align(audio, result["segments"], ..., return_char_alignments=False)` —
 *    функция из библиотеки `m-bain/whisperX`
 *    (`whisperx/alignment.py`, строка 424:
 *    `return {"segments": aligned_segments, "word_segments": word_segments}`).
 *    Каждый элемент `aligned_segments` — `{text, start, end, words: [...]}`
 *    (`alignment.py:384-389`), а каждое слово — `{word, start?, end?, score?}`,
 *    где `start`/`end` пропускаются, только если ВСЕ слова сегмента не
 *    выровнялись (`alignment.py:360-367`; в этом случае сам сегмент придёт с
 *    `words: []` — `alignment.py:221-244`). Это РОВНО форма, которую уже
 *    читает `normalizeTranscriptPayload` (segments[].words[].word/.start/.end,
 *    `server/utils/transcription/normalize.ts`) — адаптировать разбор не
 *    потребовалось, форма зафиксирована фикстурой из исходного кода в
 *    `tests/unit/transcription/normalize.spec.ts`;
 *  - ЦЕНА: страница модели `https://replicate.com/victor-upmeet/whisperx`,
 *    дословно — «This model costs approximately $0.018 to run on Replicate,
 *    or 55 runs per $1». Железо — «Nvidia A100 (80GB) GPU hardware»,
 *    «Predictions typically complete within 13 seconds». Тариф A100 на
 *    Replicate — $0.0014/с: 0.0014 × 13 = $0.0182 ≈ «approximately $0.018» —
 *    сходится;
 *  - COMMUNITY vs OFFICIAL: JSON страницы модели несёт `"is_official": false`
 *    — как и у `openai/whisper`, пометки «Official model» нет, поэтому
 *    `providerVersion` обязателен (см. докстринг `providerVersion` в
 *    `types.ts` и `runReplicateJsonModel`).
 *
 * `integrated: false` — включается на стенде явной переменной
 * `MEDIA_MODEL_TRANSCRIPTION=replicate:whisperx` (§4.1 спеки), как и было
 * задумано для транскрипции до подтверждения канарейкой на боевых деньгах.
 *
 * `timeoutMs` — 15 минут, а не 5 (было так до 27.08.2026). Стенд 26.08.2026
 * дважды подряд упал «модель не ответила за 300с» на этой же модели и том же
 * треке, который часом ранее отработал за $0.0182 (~13с работы). Модель
 * рабочая: 5 минут были тесны для холодного старта Nvidia A100 (80GB) —
 * инстанс масштабируется в ноль между вызовами, и разогрев такого железа
 * занимает минуты, плюс возможна очередь на стороне Replicate. Реальная
 * генерация в этот потолок почти не входит вовсе. 15 минут — не наугад:
 * ровно тот же потолок уже стоит у `KLING_LIP_SYNC`/`FAL_SYNC_LIPSYNC` ниже —
 * другого Replicate-контура с тем же профилем «секунды работы, холодный старт
 * может занять минуты». `REPLICATE_WHISPER` выше НЕ тронута: она работает на
 * Nvidia T4, `integrated: false` и по факту непригодна для маршрута (см. её
 * докстринг) — поднимать её потолок незачем.
 */
const REPLICATE_WHISPERX: TranscriptionModelSpec = Object.freeze<TranscriptionModelSpec>({
  registryKey: "replicate:whisperx",
  id: "victor-upmeet/whisperx",
  // Последняя версия на Replicate, created_at 2026-05-13T14:42:02Z из 25
  // версий, сверено 26.08.2026 — см. докстринг выше. Community-модель без
  // неё недоступна: `runReplicateJsonModel` без providerVersion бьёт по пути
  // официальных моделей и получает 404 (та же ошибка, что уронила canary на
  // openai/whisper).
  providerVersion: "655845d6190ef70573c669245f245892cd039df4b880a1e3a65852c09252f5cc",
  provider: "replicate",
  capability: "transcription",
  execution: "sync_json",
  billing: { unit: "hardware_second", usdPerSecond: 0.0014, estimatedSeconds: 13 },
  billingConfirmed: true,
  constraints: Object.freeze({
    // Продуктовое ограничение (что реально нужно ролику), а не ограничение
    // API: схема модели поле language вообще не валидирует списком (просто
    // nullable-строка) — large-v3 под капотом понимает почти сотню языков.
    languages: Object.freeze(["ru", "en"]),
    maxDurationSec: 600,
    audioExtensions: Object.freeze(["mp3", "wav", "m4a"]),
  }),
  timeoutMs: 15 * 60_000,
  mapInput(input) {
    const audioUrl = requireText(input.audioUrl, "audioUrl")
    const language = (input.language || "ru").slice(0, 2).toLowerCase()
    if (!this.constraints.languages.includes(language)) {
      throw new Error(`Модель ${this.id} не размечает язык "${language}"`)
    }
    return {
      payload: {
        audio_file: audioUrl,
        language,
        // Без этого поля выход — сырые сегменты model.transcribe() БЕЗ
        // ключа words вовсе (default false в схеме): именно то поле, ради
        // которого модель заведена вместо openai/whisper.
        align_output: true,
      },
    }
  },
  // Выход способности — JSON, а не ссылка на файл: скачивать нечего, разбирает
  // его `normalizeTranscriptPayload`.
  extractOutput: () => ({ urls: [] }),
  dataProcessor: null,
  integrated: false,
  tier: "budget",
  name: "WhisperX",
  vendorLabel: "Replicate / victor-upmeet",
  strengths: Object.freeze([
    "align_output реально возвращает пословные тайминги — подтверждено исходным кодом обёртки, не только схемой",
    "70x realtime на large-v3 — быстро и дёшево ($0.018 за прогон, ~13 сек)",
    "Русский распознаёт без отдельной настройки (тот же large-v3, что и у Whisper)",
  ]),
  tradeoffs: Object.freeze([
    "Community-модель: адресуется хешем версии (providerVersion), а не именем",
    "integrated=false до включения на стенде переменной MEDIA_MODEL_TRANSCRIPTION",
    "OpenAPI-схема не раскрывает форму segments — она сверена исходным кодом обёртки, а не самим API-ответом",
  ]),
  avgGenerationTime: "~13 сек (типичное время страницы модели)",
})

/**
 * ISO-код нашего продукта → полное английское имя языка в enum схемы
 * `vaibhavs10/incredibly-fast-whisper`. Ключи ЗАДАЮТ продуктовый набор
 * поддерживаемых языков (те же ru/en, что у REPLICATE_WHISPER/REPLICATE_WHISPERX
 * выше) — `mapInput` ниже читает язык ИСКЛЮЧИТЕЛЬНО через эту карту, так что
 * набору неоткуда разойтись с проверкой (в отличие от старых двух спек, где
 * список языков и валидация — два отдельных места).
 */
const INCREDIBLY_FAST_WHISPER_LANGUAGE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  ru: "russian",
  en: "english",
})

/**
 * `vaibhavs10/incredibly-fast-whisper` на Replicate — замена `victor-upmeet/whisperx`
 * для маршрута «монтаж от звука».
 *
 * ПРИЧИНА ЗАМЕНЫ (боевой стенд, 26-27.08.2026): WhisperX живёт на Nvidia A100
 * (80GB) — дефицитном SKU. Транскрипция отработала один раз ($0.0182, тариф
 * сошёлся), а следующие ТРИ прогона подряд не дождались ответа — сперва за
 * 300с (прежний потолок), потом дважды за 900с (потолок, поднятый именно из-за
 * этого инцидента — см. `transcription-whisperx-sync-json.spec.ts` соседнего
 * фикса и докстринг `REPLICATE_WHISPERX` выше). Кода транскрипции между
 * удачным прогоном и тремя отказами никто не трогал: разброс объясняется
 * доступностью самого SKU, а не нашим дефектом. При цели 300 роликов в сутки
 * ждать дефицитный GPU на каждом ролике — риск, который нельзя принять молча.
 * `incredibly-fast-whisper` — тот же `openai/whisper-large-v3` под капотом
 * (`transformers.pipeline`, `use_flash_attention_2`), но на Nvidia L40S — SKU
 * с явно заявленной у Replicate ёмкостью на несколько инстансов
 * (`gpu-l40s-2x/4x/8x` на `replicate.com/pricing`), в отличие от A100 (80GB).
 *
 * Все факты ниже сверены НАПРЯМУЮ 27.08.2026, тем же публичным способом, что и
 * у `openai/whisper`/`victor-upmeet/whisperx` (без токена, без единого
 * платного вызова):
 *
 *  - ВЕРСИЯ: `https://replicate.com/api/models/vaibhavs10/incredibly-fast-whisper/versions`
 *    отдал 4 версии; ПОСЛЕДНЯЯ (и единственная с `created_at` 2024-02-16,
 *    остальные три — от 2023-11-13 и 2024-01-31) — `3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c`.
 *    Хеш, продиктованный задачей на этот фикс, совпал с прямой проверкой —
 *    подтверждён, а не принят на веру;
 *  - СХЕМА ВХОДА: `_extras.dereferenced_openapi_schema` той же версии,
 *    `components.schemas.Input`. Обязателен только `audio` (`type: string,
 *    format: uri`). `task` — enum `transcribe`/`translate`, default
 *    `transcribe`. `language` — enum ИЗ ПОЛНЫХ АНГЛИЙСКИХ НАЗВАНИЙ ЯЗЫКОВ
 *    (`"None"`, `"afrikaans"`, …, `"russian"`, …, `"yoruba"` — почти сотня
 *    значений), default `"None"` (автоопределение). **ЛОВУШКА**: это НЕ
 *    ISO-коды — `"ru"` отсутствует в enum вовсе и был бы отвергнут валидацией
 *    Cog до единого платного вызова (422). `timestamp` — enum `chunk`/`word`,
 *    default `chunk`: без явного `"word"` пословных границ не будет вовсе (то
 *    же по духу, что `align_output: false` по умолчанию у WhisperX). Плюс
 *    необязательные `batch_size` (default 24), `diarise_audio` (default
 *    false), `hf_token` — не отправляем, дефолты нас устраивают;
 *  - СХЕМА ВЫХОДА: `components.schemas.Output` — буквально `{"title":
 *    "Output"}`, Cog не раскрывает форму вовсе (та же картина, что у
 *    WhisperX). Форма снята из ИСХОДНОГО КОДА, не угадана — три независимых
 *    источника сходятся (полная цепочка и код фикстуры — в докстринге теста
 *    `tests/unit/transcription/normalize.spec.ts`, "читает реальную форму
 *    vaibhavs10/incredibly-fast-whisper"):
 *      1. Cog-обёртка `chenxwh/insanely-fast-whisper/predict.py` зовёт
 *         `self.pipe(audio, ..., return_timestamps="word" if timestamp ==
 *         "word" else True)` и без диаризации возвращает `outputs` как есть —
 *         то, что вернул HF-пайплайн, без переупаковки;
 *      2. `transformers/pipelines/automatic_speech_recognition.py`: для
 *         Whisper (`type == "seq2seq_whisper"`) — `text, optional =
 *         self.tokenizer._decode_asr(...)`, затем `return {"text": text,
 *         **optional, **extra}`;
 *      3. `transformers/models/whisper/tokenization_whisper.py::_decode_asr`
 *         → `_collate_word_timestamps` в word-режиме: каждое слово —
 *         `{"text": word, "timestamp": (start, end)}` (кортеж → JSON-массив),
 *         и `if return_timestamps == "word": optional = {"chunks":
 *         [слово для слова из всех сегментов]}` — то есть `chunks` ПЛОСКИЙ
 *         список слов, а НЕ сегменты со вложенными словами (в отличие от
 *         WhisperX). Итог: `{ text: string, chunks: [{ text, timestamp:
 *         [start, end] }] }` — форма, которую `normalizeTranscriptPayload`
 *         уже читает веткой `chunks`+`timestamp`-массив (`server/utils/transcription/normalize.ts`),
 *         разбор менять не потребовалось;
 *  - ЦЕНА/ЖЕЛЕЗО: страница модели `https://replicate.com/vaibhavs10/incredibly-fast-whisper`,
 *    дословно — «This model costs approximately $0.0040 to run on Replicate,
 *    or 250 runs per $1», «This model runs on Nvidia L40S GPU hardware»,
 *    «Predictions typically complete within 5 seconds». Встроенный в страницу
 *    JSON (`_extras`) даёт то же ТОЧНЕЕ: `"hardware": "L40S", "price":
 *    "$0.000975 per second", "p50price": "$0.0040"` — именно из этих двух
 *    полей Replicate сам строит фразу «approximately $0.0040». Ставка L40S
 *    сверена НЕЗАВИСИМО на `replicate.com/pricing`: строка `gpu-l40s` (не
 *    `gpu-l40s-2x/4x/8x` — у них другая, кратная ставка) даёт то же
 *    `$0.000975/sec`;
 *  - **estimatedSeconds ниже — НЕ буквальные «5 секунд» из прозы страницы.**
 *    `0.000975 × 5 = $0.004875` — на 22% ВЫШЕ заявленной цены, то есть прямое
 *    чтение прозы дало бы систематически завышенный биллинг. «Typically
 *    complete within N seconds» — это, по всей видимости, округлённый потолок
 *    отображения (возможно, старшая перцентиль), а НЕ p50-время, на котором
 *    Replicate считает саму цену. Число ниже — обратный счёт из `p50price`
 *    страницы: `0.0040 / 0.000975 ≈ 4.10` с, округлено до одного знака. Это не
 *    догадка: оба входных числа (`price`, `p50price`) сняты напрямую с той же
 *    страницы, тем же способом, что и у сестринских спек. Разошлось с прозой —
 *    предпочтён более точный источник, а не более привычный;
 *  - ЭТО ВАЖНЕЕ, ЧЕМ У WHISPER/WHISPERX: ветка `sync_json` раннера
 *    (`runReplicateJsonModel`, `server/utils/replicate/json-model.ts`)
 *    возвращает ТОЛЬКО `prediction.output`, без `prediction.metrics` — то
 *    есть `metrics.predict_time` НИКУДА не долетает, и вызывающий код
 *    (`server/utils/transcription/media-task.ts`) для transcription передаёт
 *    только `usage: { audioSeconds }`, никогда `hardwareSeconds`.
 *    `estimateMediaCost` для `hardware_second` берёт `usage.hardwareSeconds ??
 *    billing.estimatedSeconds` — а раз факта не бывает НИКОГДА, `estimatedSeconds`
 *    здесь не черновая оценка «на будущее», а ФАКТИЧЕСКАЯ цена каждого
 *    реального прогона в `AiAuditLog`/`Video.totalCostActual`. Точность этого
 *    поля — это точность денег, а не смёты;
 *  - COMMUNITY vs OFFICIAL: встроенный JSON страницы несёт `"is_official":
 *    false` — как и у `openai/whisper`/`victor-upmeet/whisperx`, пометки
 *    «Official model» нет, поэтому `providerVersion` обязателен (см. докстринг
 *    `providerVersion` в `types.ts` и `runReplicateJsonModel`).
 *
 * `integrated: false` — включается на стенде явной переменной
 * `MEDIA_MODEL_TRANSCRIPTION=replicate:incredibly-fast-whisper` (§4.1 спеки),
 * тем же путём, что и REPLICATE_WHISPERX.
 *
 * `timeoutMs` — 15 минут, вровень с `REPLICATE_WHISPERX`/`KLING_LIP_SYNC`/
 * `FAL_SYNC_LIPSYNC`, а НЕ прежние 5 минут `REPLICATE_WHISPER`. Причина замены
 * модели — дефицитность КОНКРЕТНОГО SKU (A100 80GB), а не холодный старт как
 * класс: L40S — тоже Replicate-модель с автомасштабированием в ноль между
 * вызовами, и тот же риск «секунды работы, разогрев может занять минуты»
 * актуален для любого community-контура на Replicate независимо от того,
 * насколько ходовое у него железо. Понижать потолок обратно до 5 минут для
 * модели, заведённой РОВНО ради устойчивости к холодному старту/очереди
 * провайдера, было бы отменой смысла всего фикса.
 *
 * Языки: `mapInput` принимает НАШ продуктовый ISO-код (`ru`/`en`, тот же набор,
 * что у сестринских спек) и переводит его в полное имя через
 * `INCREDIBLY_FAST_WHISPER_LANGUAGE_NAMES` выше. Язык за пределами этого
 * набора — ЧЕСТНЫЙ ОТКАЗ (`throw`), а не молчаливая подстановка `"None"`
 * (автоопределение модели): у нас язык сцены известен из сценария заранее
 * (spec §4.1 — `language?: string`, подсказка), значит незнакомый код здесь —
 * всегда баг вызывающего кода (сценарий на незаявленном языке продукта), а не
 * легитимный случай «мы не знаем язык». Прятать баг за автоопределением значит
 * получить транскрипт на угаданном языке с тихо неверными границами вместо
 * понятной ошибки до оплаты — тот же выбор, что уже сделан у
 * REPLICATE_WHISPER/REPLICATE_WHISPERX (оба тоже бросают, а не пропускают
 * язык дальше).
 */
const REPLICATE_INCREDIBLY_FAST_WHISPER: TranscriptionModelSpec = Object.freeze<TranscriptionModelSpec>({
  registryKey: "replicate:incredibly-fast-whisper",
  id: "vaibhavs10/incredibly-fast-whisper",
  // Единственная версия с created_at 2024-02-16 из 4 версий — при этом самая
  // свежая (следующая по времени — 2024-01-31). Сверено 27.08.2026 напрямую с
  // публичного эндпоинта versions (см. докстринг выше).
  providerVersion: "3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
  provider: "replicate",
  capability: "transcription",
  execution: "sync_json",
  // Nvidia L40S: $0.000975/с (replicate.com/pricing, sku gpu-l40s). estimatedSeconds —
  // обратный счёт из p50price страницы модели ($0.0040 / $0.000975 ≈ 4.10 с),
  // а не буквальные "typically complete within 5 seconds" прозы — см.
  // докстринг спеки выше про 22%-ное расхождение и про то, что для этой
  // способности estimatedSeconds есть ФАКТИЧЕСКАЯ цена, а не черновая оценка.
  billing: { unit: "hardware_second", usdPerSecond: 0.000975, estimatedSeconds: 4.1 },
  billingConfirmed: true,
  constraints: Object.freeze({
    // Ключи INCREDIBLY_FAST_WHISPER_LANGUAGE_NAMES — единственный источник
    // продуктового набора языков, отсюда и здесь: разойтись им неоткуда.
    languages: Object.freeze(Object.keys(INCREDIBLY_FAST_WHISPER_LANGUAGE_NAMES)),
    maxDurationSec: 600,
    audioExtensions: Object.freeze(["mp3", "wav", "m4a"]),
  }),
  timeoutMs: 15 * 60_000,
  mapInput(input) {
    const audioUrl = requireText(input.audioUrl, "audioUrl")
    const isoLanguage = (input.language || "ru").slice(0, 2).toLowerCase()
    const language = INCREDIBLY_FAST_WHISPER_LANGUAGE_NAMES[isoLanguage]
    if (!language) {
      throw new Error(`Модель ${this.id} не размечает язык "${isoLanguage}"`)
    }
    return {
      payload: {
        audio: audioUrl,
        language,
        // Без этого поля выход — chunks на уровне СЕГМЕНТОВ (default "chunk"),
        // без пословных границ вовсе. Именно ради "word" модель и выбрана.
        timestamp: "word",
      },
    }
  },
  // Выход способности — JSON, а не ссылка на файл: скачивать нечего, разбирает
  // его `normalizeTranscriptPayload`.
  extractOutput: () => ({ urls: [] }),
  dataProcessor: null,
  integrated: false,
  tier: "budget",
  name: "Incredibly Fast Whisper",
  vendorLabel: "Replicate / vaibhavs10",
  strengths: Object.freeze([
    "Тот же openai/whisper-large-v3, что и у Whisper/WhisperX, но на Nvidia L40S — не на дефицитном A100 (80GB)",
    "Пословные тайминги (timestamp: word) — подтверждено исходным кодом обёртки и transformers, не только схемой",
    "Дешевле WhisperX: ~$0.0040 против ~$0.018 за прогон (p50price страницы модели)",
    "Русский распознаёт без отдельной настройки (тот же large-v3, что и у Whisper/WhisperX)",
  ]),
  tradeoffs: Object.freeze([
    "Community-модель: адресуется хешем версии (providerVersion), а не именем",
    "integrated=false до включения на стенде переменной MEDIA_MODEL_TRANSCRIPTION",
    "language — enum ПОЛНЫХ ИМЁН языков ('russian', не 'ru'); ISO-код был бы отвергнут схемой до оплаты",
    "OpenAPI-схема не раскрывает форму chunks — она сверена исходным кодом Cog-обёртки и transformers, а не самим API-ответом",
  ]),
  avgGenerationTime: "~4-5 сек (p50 страницы модели; прозе \"within 5 seconds\" соответствует верхняя граница)",
})

/**
 * Порядок значим: витрина и дефолты («первая integrated модель способности»)
 * читают этот массив сверху вниз.
 *
 * Модель Replicate стоит первой в своей способности везде, где она подключена:
 * `docs/PROJECT_CONTEXT.md` §5 требует Replicate основным провайдером медиа, а
 * fal оставляет явным резервом. Исключение — image_to_video: его маршрут
 * переводится отдельным этапом со своим canary (см. REPLICATE_KLING_16_I2V).
 */
export const MEDIA_MODEL_SPECS: readonly MediaModelSpec[] = Object.freeze([
  FLUX_DEV_REPLICATE,
  FLUX_SCHNELL,
  FLUX_DEV,
  REPLICATE_KLING_16_T2V,
  KLING_V3_STANDARD,
  KLING_V3_PRO,
  WAN_V22,
  HAILUO_02_STANDARD,
  REPLICATE_KLING_16_I2V,
  KLING_V21_IMAGE_TO_VIDEO,
  MINIMAX_SPEECH_02_TURBO,
  KOKORO_EN,
  KOKORO_RU,
  PLAYAI_V3,
  ELEVENLABS_TURBO,
  FISH_S21_PRO_FREE,
  FISH_S21_PRO,
  KLING_LIP_SYNC,
  SYNC_LIPSYNC_2,
  SYNC_LIPSYNC_2_PRO,
  FAL_SYNC_LIPSYNC,
  PRUNA_P_VIDEO_AVATAR,
  VEED_FABRIC_1,
  BYTEDANCE_OMNI_HUMAN,
  KLING_AVATAR_V2,
  WAN_22_S2V,
  FLUX_KONTEXT_DEV,
  FLUX_KONTEXT_PRO,
  FLUX_KONTEXT_MAX,
  BYTEDANCE_FLUX_PULID,
  REPLICATE_WHISPER,
  REPLICATE_WHISPERX,
  REPLICATE_INCREDIBLY_FAST_WHISPER,
])
