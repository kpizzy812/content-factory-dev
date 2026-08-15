/**
 * Клиент Fish Audio.
 *
 * Третий провайдер контура и третий транспорт: Replicate отдаёт prediction,
 * fal — ссылку на выход, Fish — БАЙТЫ аудио прямо в теле ответа.
 *
 * Схема снята с `https://api.fish.audio/openapi.json` 15.08.2026:
 *   POST /v1/tts — обязателен только `text`, модель выбирается ЗАГОЛОВКОМ
 *   `model` (enum: s1, s2-pro, s2.1-pro, s2.1-pro-free).
 *
 * Кошелёк API у Fish отдельный от тарифа платформы: бесплатный план на API не
 * распространяется, платные модели отвечают 402 «Insufficient API credit».
 * Поэтому 402 разбирается отдельно — иначе оператор ищет ошибку в коде.
 */

export interface FishConfig {
  apiKey: string
  baseUrl: string
}

export class FishError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Пополнить API-кошелёк: тариф платформы на API не действует. */
    readonly needsCredit: boolean,
  ) {
    super(message)
    this.name = "FishError"
  }
}

export function readFishConfig(env: NodeJS.ProcessEnv = process.env): FishConfig {
  const apiKey = env.FISH_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("FISH_API_KEY is required for the Fish Audio provider")
  }
  return { apiKey, baseUrl: env.FISH_API_BASE_URL?.trim() || "https://api.fish.audio" }
}

export interface FishSpeechResult {
  bytes: Buffer
  contentType: string
}

/**
 * Синтез речи. `modelId` уходит заголовком, payload — телом.
 *
 * Возвращает байты: у Fish нет промежуточной ссылки, которую можно было бы
 * скачать позже, и это меняет контур — результат надо писать на диск сразу.
 */
export async function synthesizeFishSpeech(
  modelId: string,
  payload: Record<string, unknown>,
  config: FishConfig,
  timeoutMs: number,
): Promise<FishSpeechResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${config.baseUrl}/v1/tts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "model": modelId,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300)
      throw new FishError(
        `Fish Audio ${modelId}: ${response.status} ${detail}`,
        response.status,
        response.status === 402,
      )
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0) {
      throw new FishError(`Fish Audio ${modelId}: пустой ответ`, response.status, false)
    }
    return { bytes, contentType: response.headers.get("content-type") ?? "audio/mpeg" }
  }
  finally {
    clearTimeout(timer)
  }
}
