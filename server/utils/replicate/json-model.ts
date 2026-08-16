/**
 * Синхронный вызов модели Replicate, отдающей СТРУКТУРУ, а не файл.
 *
 * Асинхронный контур (`prediction-service`) построен вокруг переноса выходного
 * ФАЙЛА в наше хранилище и вокруг вебхука. Транскрипция возвращает объект со
 * словами и отрабатывает за секунды — весь этот аппарат ей не нужен, а
 * `persistedStorageKey` для неё принципиально пуст.
 *
 * Поэтому здесь прямой вызов predictions API с поллингом. Конфигурация
 * читается вызывающим: `readReplicateConfig()` требует переменные вебхука,
 * которых синхронному вызову не нужно, — на стенде без них шаг падал бы ещё до
 * обращения к модели.
 */

import type { ReplicateConfig } from "./config"

const POLL_INTERVAL_MS = 2_000

export interface ReplicateJsonModelDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export async function runReplicateJsonModel(
  modelId: string,
  payload: Record<string, unknown>,
  config: ReplicateConfig,
  timeoutMs: number,
  deps: ReplicateJsonModelDeps = {},
): Promise<unknown> {
  if (config.mockMode) {
    // Мок отдаёт форму `chunks`, которую понимает нормализатор: локальный стенд
    // обязан проходить маршрут целиком без единого платного вызова.
    return {
      text: "мок транскрипции",
      chunks: [
        { text: "мок", timestamp: [0, 0.4] },
        { text: "транскрипции", timestamp: [0.4, 1.2] },
      ],
    }
  }

  const token = config.apiToken
  if (!token) {
    throw new Error("Транскрипция: REPLICATE_API_TOKEN не задан, а мок-режим выключен")
  }

  const doFetch = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const deadline = Date.now() + timeoutMs

  const created = await doFetch("https://api.replicate.com/v1/models/" + modelId + "/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "wait",
    },
    body: JSON.stringify({ input: payload }),
  })
  if (!created.ok) {
    throw new Error(`Транскрипция: Replicate ответил ${created.status} при создании задачи`)
  }

  let prediction = await created.json() as { id: string, status: string, output?: unknown, error?: unknown }

  while (prediction.status === "starting" || prediction.status === "processing") {
    if (Date.now() > deadline) {
      throw new Error(`Транскрипция: модель ${modelId} не ответила за ${Math.round(timeoutMs / 1000)}с`)
    }
    await sleep(POLL_INTERVAL_MS)
    const polled = await doFetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!polled.ok) {
      throw new Error(`Транскрипция: Replicate ответил ${polled.status} при опросе задачи`)
    }
    prediction = await polled.json() as typeof prediction
  }

  if (prediction.status !== "succeeded") {
    const reason = typeof prediction.error === "string" ? prediction.error : prediction.status
    throw new Error(`Транскрипция: задача завершилась как ${reason}`)
  }

  // "succeeded" без output — вырожденный, но реальный случай ответа Replicate.
  // Без проверки JSON.stringify(undefined) отдаст undefined, а Buffer.from(undefined)
  // в вызывающем коде упадёт невнятным TypeError вместо понятной причины.
  if (prediction.output === undefined || prediction.output === null) {
    throw new Error(`Транскрипция: модель ${modelId} завершилась успешно, но не вернула output`)
  }

  return prediction.output
}
