import { createHash } from "node:crypto"
import type {
  CreateMediaPredictionInput,
  MediaProvider,
  NormalizedMediaPrediction,
} from "../media-provider/types"

export interface MockReplicateProviderOptions {
  completeAfterPolls?: number
  /**
   * Жёсткий override выхода на все способности. Оставлен для тестов, которым
   * важен конкретный URL; по умолчанию выход выбирается по capability.
   */
  outputUrl?: string
  /**
   * Длительность выходного медиа, если вызывающий её знает (lip-sync заказывает
   * клип длиной исходника, text-to-video — длиной сцены).
   *
   * Без неё заглушка отдаёт видео своей длины по умолчанию, и проверка «клип
   * получился той длины, которую заказали» превращается в проверку константы.
   */
  outputDurationSec?: number | null
}

interface MockState {
  polls: number
  outputUrl: string
  prediction: NormalizedMediaPrediction
}

/**
 * Расширение выхода по способности.
 *
 * Мок обязан зависеть от capability: через тот же контур пойдут не только
 * lip-sync, но и изображения, клипы и речь. Один mp4 на всё означал бы, что
 * интеграционный тест картинки скачивает «png», внутри которого видео, и
 * ошибка типа выхода вылезала бы только на реальных деньгах.
 *
 * Ключ — строка, а не MediaCapability: реестр способностей расширяется
 * отдельной задачей, и мок не должен ждать её, чтобы компилироваться.
 */
const OUTPUT_EXTENSION_BY_CAPABILITY: Record<string, string> = {
  lip_sync: "mp4",
  text_to_video: "mp4",
  image_to_video: "mp4",
  text_to_image: "png",
  text_to_speech: "mp3",
  // Аватарная сцена: портрет плюс речь дают видео со встроенным звуком.
  speech_to_video: "mp4",
  // Вариации портрета: маппер просит output_format=jpg, мок обязан совпадать.
  image_to_image: "jpg",
}

/**
 * Детерминированный URL выхода мока.
 *
 * Первый сегмент — имя провайдера, второй — СПОСОБНОСТЬ: по ней
 * `generateMockPlaceholder` (`server/utils/mock/fal-mock.ts`) и выбирает вид
 * заглушки. Раньше он умел читать только форму fal (`mock://video/{id}`), эта
 * ссылка попадала в ветку «неизвестно» и вместо клипа получался JSON под
 * именем `.mp4`; из-за него весь Replicate-контур в тестах не исполнялся.
 * Тип выхода дополнительно несёт расширение в конце пути: по нему
 * `inferExtension` (`prediction-service.ts`) кладёт результат под правильным
 * расширением, а тесты видят png/mp3/mp4 там, где их ждут.
 *
 * Длительность уходит query-параметром и только когда она известна: заглушка
 * обязана быть той длины, которую заказали, иначе проверка длины клипа не
 * проверяет ничего.
 */
export function mockReplicateOutputUrl(
  capability: string,
  externalId: string,
  outputDurationSec?: number | null,
): string {
  const extension = OUTPUT_EXTENSION_BY_CAPABILITY[capability]
  if (!extension) {
    throw new Error(
      `Mock Replicate provider has no output type for capability: ${capability}. `
      + "Добавьте способность в OUTPUT_EXTENSION_BY_CAPABILITY, иначе тест получит выход чужого типа.",
    )
  }
  const base = `mock://replicate/${capability}/${externalId}.${extension}`
  const duration = typeof outputDurationSec === "number" && Number.isFinite(outputDurationSec) && outputDurationSec > 0
    ? outputDurationSec
    : null
  return duration === null ? base : `${base}?duration=${duration.toFixed(3)}`
}

export function createMockReplicateProvider(
  options: MockReplicateProviderOptions = {},
): MediaProvider {
  const completeAfterPolls = options.completeAfterPolls ?? 1
  const predictions = new Map<string, MockState>()

  return {
    name: "replicate",

    async create(request: CreateMediaPredictionInput): Promise<NormalizedMediaPrediction> {
      const externalId = stablePredictionId(request.idempotencyKey)
      const existing = predictions.get(externalId)
      if (existing) return existing.prediction

      // Тип выхода фиксируем на сабмите: неизвестная способность должна падать
      // там же, где её отправили, а не выдавать mp4 под видом картинки.
      const outputUrl = options.outputUrl
        ?? mockReplicateOutputUrl(request.model.capability, externalId, options.outputDurationSec)

      const prediction: NormalizedMediaPrediction = {
        externalId,
        provider: "replicate",
        model: request.model.id,
        status: "processing",
        outputUrl: null,
        error: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: null,
        raw: {
          mock: true,
          idempotencyKey: request.idempotencyKey,
        },
      }
      predictions.set(externalId, { polls: 0, outputUrl, prediction })
      return prediction
    },

    async get(externalId: string): Promise<NormalizedMediaPrediction> {
      const state = requireState(predictions, externalId)
      state.polls += 1
      if (state.prediction.status === "processing" && state.polls >= completeAfterPolls) {
        state.prediction = {
          ...state.prediction,
          status: "succeeded",
          outputUrl: state.outputUrl,
          completedAt: new Date("2026-01-01T00:00:05.000Z"),
          raw: { ...state.prediction.raw, polls: state.polls },
        }
      }
      return state.prediction
    },

    async cancel(externalId: string): Promise<NormalizedMediaPrediction> {
      const state = requireState(predictions, externalId)
      if (state.prediction.status === "processing" || state.prediction.status === "starting") {
        state.prediction = {
          ...state.prediction,
          status: "canceled",
          completedAt: new Date("2026-01-01T00:00:01.000Z"),
        }
      }
      return state.prediction
    },
  }
}

function stablePredictionId(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)
  return `mock_${digest}`
}

function requireState(
  predictions: Map<string, MockState>,
  externalId: string,
): MockState {
  const state = predictions.get(externalId)
  if (!state) throw new Error(`Mock Replicate prediction not found: ${externalId}`)
  return state
}
