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
}

/**
 * Детерминированный URL выхода мока.
 *
 * Первый сегмент оставлен `replicate` намеренно. `generateMockPlaceholder`
 * (`server/utils/mock/fal-mock.ts`) выбирает генератор заглушки по первому
 * сегменту, и ветки `video`/`image`/`audio` собирают файл через ffmpeg в кеш
 * `<kind>.bin` — такой контейнер ffmpeg не мультиплексирует, заявка падает.
 * Ветка по умолчанию пишет JSON-заглушку без ffmpeg и без сети, что моку и
 * нужно. Тип выхода несёт расширение в конце пути: по нему `inferExtension`
 * (`prediction-service.ts`) кладёт результат под правильным расширением, а
 * тесты видят png/mp3/mp4 там, где их ждут.
 */
export function mockReplicateOutputUrl(capability: string, externalId: string): string {
  const extension = OUTPUT_EXTENSION_BY_CAPABILITY[capability]
  if (!extension) {
    throw new Error(
      `Mock Replicate provider has no output type for capability: ${capability}. `
      + "Добавьте способность в OUTPUT_EXTENSION_BY_CAPABILITY, иначе тест получит выход чужого типа.",
    )
  }
  return `mock://replicate/${capability}/${externalId}.${extension}`
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
        ?? mockReplicateOutputUrl(request.model.capability, externalId)

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
