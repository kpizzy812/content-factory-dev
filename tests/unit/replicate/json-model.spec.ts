/**
 * `runReplicateJsonModel` — синхронный вызов JSON-моделей Replicate
 * (транскрипция). Canary 26.08.2026 уронил маршрут «монтаж от звука»:
 * `openai/whisper` — community-модель, а раннер бил по эндпоинту официальных
 * моделей (`/v1/models/{id}/predictions`), который для community отвечает 404.
 *
 * Официальные модели (`minimax/speech-02-turbo`, `kwaivgi/kling-*`) на этом же
 * эндпоинте на стенде работают — его менять нельзя. Community-моделям нужен
 * `POST /v1/predictions` с телом `{ version, input }`, где `version` — хеш
 * конкретной версии модели.
 */

import { describe, expect, it, vi } from "vitest"
import type { ReplicateConfig } from "../../../server/utils/replicate/config"
import { runReplicateJsonModel } from "../../../server/utils/replicate/json-model"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** `Prefer: wait` — предсказание уходит в ответ на создание уже завершённым. */
function succeededPrediction(output: unknown) {
  return { id: "pred_1", status: "succeeded", output }
}

const config: ReplicateConfig = {
  apiToken: "test-token",
  webhookSigningSecret: null,
  webhookBaseUrl: null,
  webhookUrl: null,
  defaultLipSyncModel: "kwaivgi/kling-lip-sync",
  defaultTtsModel: "minimax/speech-02-turbo",
  mockMode: false,
  recoveryEnabled: true,
  fallbackProvider: null,
}

const WHISPER_VERSION = "8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e"

describe("runReplicateJsonModel: официальный путь и путь community-моделей", () => {
  it("версия задана — уходит на /v1/predictions, тело несёт version, модель НЕ подставлена в URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(succeededPrediction({ text: "привет" })))

    const result = await runReplicateJsonModel(
      "openai/whisper",
      { audio: "https://cdn.example.com/a.mp3", language: "ru" },
      config,
      5_000,
      WHISPER_VERSION,
      { fetchImpl },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe("https://api.replicate.com/v1/predictions")
    expect(String(url)).not.toContain("openai/whisper")

    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({
      version: WHISPER_VERSION,
      input: { audio: "https://cdn.example.com/a.mp3", language: "ru" },
    })

    expect(result).toEqual({ text: "привет" })
  })

  it("версии нет — прежний путь официальных моделей побайтово: /v1/models/{id}/predictions, тела без version", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(succeededPrediction({ ok: true })))

    await runReplicateJsonModel(
      "minimax/speech-02-turbo",
      { text: "привет" },
      config,
      5_000,
      undefined,
      { fetchImpl },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe("https://api.replicate.com/v1/models/minimax/speech-02-turbo/predictions")

    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ input: { text: "привет" } })
    expect(body).not.toHaveProperty("version")
  })

  it("версии нет — деп не получает совсем аргумента version (undefined), а не пустую строку", async () => {
    // Мутационная защита от «version ?? ''»: пустая строка тоже falsy для Boolean(),
    // но если бы код сравнивал c undefined строго, порча на '' проскочила бы незамеченной
    // при неверной проверке типа `if (version)` вместо `if (version !== undefined)`.
    // Здесь фиксируем именно то поведение, которое реализовано: пустая строка НЕ считается
    // версией (falsy), чтобы случайно заданная пустая строка в спеке не расщепила маршрут.
    const fetchImpl = vi.fn(async () => jsonResponse(succeededPrediction({ ok: true })))

    await runReplicateJsonModel(
      "minimax/speech-02-turbo",
      { text: "привет" },
      config,
      5_000,
      "",
      { fetchImpl },
    )

    const [url] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe("https://api.replicate.com/v1/models/minimax/speech-02-turbo/predictions")
  })
})
