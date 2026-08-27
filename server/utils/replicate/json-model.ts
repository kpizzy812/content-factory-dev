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
 *
 * ДВА РЕЖИМА СОЗДАНИЯ ЗАДАЧИ (canary 26.08.2026, whisper-version-report.md):
 *  - `version` не задан — прежний путь ОФИЦИАЛЬНЫХ моделей Replicate,
 *    `POST /v1/models/{modelId}/predictions`, `id` сам разрешает последнюю
 *    версию. Байт-в-байт как было: `minimax/speech-02-turbo` и
 *    `kwaivgi/kling-*` на этом пути работают на стенде, ломать нельзя.
 *  - `version` задан — путь COMMUNITY-моделей, `POST /v1/predictions` с телом
 *    `{ version, input }`. `openai/whisper` — community-модель без пометки
 *    «Official model»: эндпоинт официальных моделей отвечает ей 404, именно
 *    так и упал маршрут «монтаж от звука» на стенде.
 *
 * ПОТОЛОК ОЖИДАНИЯ (`timeoutMs`) — это `spec.timeoutMs` из `model-specs.ts`,
 * НЕ отдельная настройка этого модуля: дедлайн здесь — единственное место,
 * которое его считает и сравнивает с временем. У опроса свой, гораздо более
 * короткий интервал (`POLL_INTERVAL_MS`) — он определяет ТОЛЬКО частоту
 * запросов к Replicate, а не то, когда раннер сдаётся.
 *
 * Стенд 26.08.2026: `victor-upmeet/whisperx` дважды подряд не уложилась в
 * тогдашние 5 минут (`REPLICATE_WHISPERX.timeoutMs`), хотя тремя часами раньше
 * тот же трек на той же модели отработал за $0.0182 (~13с работы на A100).
 * Модель рабочая — тесен был потолок: GPU-инстанс A100 масштабируется в ноль,
 * и холодный старт такого железа занимает минуты, плюс возможна очередь на
 * стороне Replicate. Отсюда `onWaiting` ниже: без периодической отметки в лог
 * шага 15 минут тишины неотличимы оператором от зависшего опроса.
 */

import type { ReplicateConfig } from "./config"

const POLL_INTERVAL_MS = 2_000

/**
 * Как часто отчитываемся в лог шага, что ожидание продолжается.
 *
 * Не на каждый опрос (раз в 2с — лог шага захлебнулся бы за 15 минут), а
 * достаточно часто, чтобы оператор видел разницу между «ждём холодный старт
 * GPU» и «зависли» раньше, чем истечёт весь потолок.
 */
export const WAIT_PROGRESS_LOG_INTERVAL_MS = 60_000

/**
 * Ответы мока ПО СПОСОБНОСТИ.
 *
 * Пока ветку `sync_json` исполняла одна транскрипция, мок мог отдавать её форму
 * безусловно. С появлением `voice_cloning` на той же ветке это стало ловушкой:
 * стенд с `REPLICATE_MOCK_MODE=true` получал на клон голоса ТРАНСКРИПТ, не
 * находил в нём `voice_id` и ронял маршрут — ровно там, где мок-режим нужнее
 * всего, потому что настоящий прогон стоит $3.
 *
 * Незнакомая способность падает громко, а не получает чужой выход: тот же
 * принцип, что у `OUTPUT_EXTENSION_BY_CAPABILITY` в `mock.ts` для файловых
 * способностей. Ключ — строка, а не `MediaCapability`: модуль транспортный и
 * зависеть от реестра способностей ему незачем.
 */
const MOCK_JSON_OUTPUT_BY_CAPABILITY: Record<string, () => unknown> = {
  // Форма `chunks` — та, которую понимает нормализатор транскрипта.
  transcription: () => ({
    text: "мок транскрипции",
    chunks: [
      { text: "мок", timestamp: [0, 0.4] },
      { text: "транскрипции", timestamp: [0.4, 1.2] },
    ],
  }),
  // Форма ответа `minimax/voice-cloning`: структура `{ voice_id, preview, model }`
  // (`scripts/clone-voice.ts`, оплаченный прогон 15.08.2026). Префикс `R8_` —
  // как у настоящего voice_id, чтобы заглушку было видно в логах и в БД.
  voice_cloning: () => ({ voice_id: "R8_MOCKVOICE01", preview: null, model: "mock" }),
}

export interface ReplicateJsonModelDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Инъекция времени для тестов — тот же приём, что у `prediction-service.ts`. */
  now?: () => number
  /**
   * Способность спеки (`MediaModelSpecBase.capability`). Нужна ТОЛЬКО моку:
   * боевой вызов о способности не знает и знать не должен — он передаёт payload
   * как есть. Без неё мок-режим отвечать нечем, и это честнее, чем выдать
   * транскрипт тому, кто просил не транскрипт.
   */
  capability?: string
  /**
   * Сигнал «мы всё ещё ждём», не чаще чем раз в {@link WAIT_PROGRESS_LOG_INTERVAL_MS}.
   * Не вызывается после того, как предсказание перестало быть starting/processing —
   * иначе в лог шага попала бы ложная отметка «ещё ждём» в момент, когда ответ
   * уже пришёл. Сбой самого колбэка (например, запись в БД) — не повод ронять
   * ожидание ответа провайдера, поэтому он оборачивается в try/catch здесь же.
   */
  onWaiting?: (elapsedMs: number) => void | Promise<void>
}

export async function runReplicateJsonModel(
  modelId: string,
  payload: Record<string, unknown>,
  config: ReplicateConfig,
  timeoutMs: number,
  /**
   * Хеш версии community-модели (`MediaModelSpecBase.providerVersion`).
   * Не задан или пустая строка — прежний путь официальных моделей.
   */
  version?: string,
  deps: ReplicateJsonModelDeps = {},
): Promise<unknown> {
  if (config.mockMode) {
    // Локальный стенд обязан проходить маршрут целиком без единого платного
    // вызова — но именно СВОЙ маршрут: выход выбирается по способности.
    const build = deps.capability ? MOCK_JSON_OUTPUT_BY_CAPABILITY[deps.capability] : undefined
    if (!build) {
      throw new Error(
        `Мок Replicate не знает JSON-выход способности ${deps.capability ?? "(не передана)"} `
        + `(модель ${modelId}). Добавьте её в MOCK_JSON_OUTPUT_BY_CAPABILITY: молча отданный выход `
        + "чужой способности — это брак, который всплывёт только на реальных деньгах.",
      )
    }
    return build()
  }

  const token = config.apiToken
  if (!token) {
    throw new Error("Транскрипция: REPLICATE_API_TOKEN не задан, а мок-режим выключен")
  }

  const doFetch = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const now = deps.now ?? Date.now
  const startedAt = now()
  const deadline = startedAt + timeoutMs

  // Пустая строка — как отсутствие: спека не должна расщеплять маршрут
  // случайно заданной "", это не валидный хеш версии.
  const url = version
    ? "https://api.replicate.com/v1/predictions"
    : "https://api.replicate.com/v1/models/" + modelId + "/predictions"
  const body: Record<string, unknown> = version
    ? { version, input: payload }
    : { input: payload }

  const created = await doFetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "wait",
    },
    body: JSON.stringify(body),
  })
  if (!created.ok) {
    throw new Error(`Транскрипция: Replicate ответил ${created.status} при создании задачи`)
  }

  let prediction = await created.json() as { id: string, status: string, output?: unknown, error?: unknown }
  let lastProgressLogAt = startedAt

  while (prediction.status === "starting" || prediction.status === "processing") {
    if (now() > deadline) {
      throw new Error(
        `Транскрипция: модель ${modelId} не ответила за отведённые ей ${Math.round(timeoutMs / 1000)}с ожидания — `
        + "это НАШ потолок, а не отказ модели: вероятная причина — холодный старт GPU-инстанса и/или очередь "
        + "на стороне Replicate, сама генерация обычно занимает секунды. Повторный запуск шага может пройти успешно.",
      )
    }
    await sleep(POLL_INTERVAL_MS)
    const polled = await doFetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!polled.ok) {
      throw new Error(`Транскрипция: Replicate ответил ${polled.status} при опросе задачи`)
    }
    prediction = await polled.json() as typeof prediction

    const stillWaiting = prediction.status === "starting" || prediction.status === "processing"
    if (deps.onWaiting && stillWaiting) {
      const current = now()
      if (current - lastProgressLogAt >= WAIT_PROGRESS_LOG_INTERVAL_MS) {
        lastProgressLogAt = current
        try {
          await deps.onWaiting(current - startedAt)
        } catch (error) {
          console.warn(
            `[replicate/json-model] прогресс-лог ожидания ${modelId} не записан: `
            + (error instanceof Error ? error.message : String(error)),
          )
        }
      }
    }
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
