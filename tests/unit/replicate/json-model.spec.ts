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
import { runReplicateJsonModel, WAIT_PROGRESS_LOG_INTERVAL_MS } from "../../../server/utils/replicate/json-model"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** Опрашивающий `fetchImpl`: отдаёт тела строго в переданном порядке. */
function queuedFetch(bodies: unknown[]) {
  const fn = vi.fn()
  for (const body of bodies) fn.mockResolvedValueOnce(jsonResponse(body))
  return fn
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

/**
 * Стенд 26.08.2026: `victor-upmeet/whisperx` дважды подряд упала «не ответила
 * за 300с», хотя тремя часами раньше тот же трек на той же модели отработал
 * за $0.0182 (~13с работы на A100). Ограничивал НАШ потолок ожидания
 * (`timeoutMs`, считается здесь), а не отказ модели — сообщение обязано это
 * называть, а не звучать как отказ.
 */
describe("runReplicateJsonModel: потолок ожидания исчерпан — сообщение называет причину", () => {
  it("текст объясняет: это наш потолок, а не отказ модели, и указывает вероятную причину", async () => {
    const fetchImpl = queuedFetch([{ id: "pred_1", status: "processing" }])

    // timeoutMs=-1: дедлайн уже в прошлом на старте, деталь исчерпания
    // потолка проверяется детерминированно, без реального ожидания в тесте.
    await expect(runReplicateJsonModel(
      "victor-upmeet/whisperx",
      { audio_file: "https://cdn.example.com/a.mp3" },
      config,
      -1,
      undefined,
      { fetchImpl, sleep: vi.fn() },
    )).rejects.toThrow(/это НАШ потолок, а не отказ модели/)
  })

  it("называет холодный старт GPU и очередь Replicate как вероятную причину", async () => {
    const fetchImpl = queuedFetch([{ id: "pred_1", status: "processing" }])

    await expect(runReplicateJsonModel(
      "victor-upmeet/whisperx",
      { audio_file: "https://cdn.example.com/a.mp3" },
      config,
      -1,
      undefined,
      { fetchImpl, sleep: vi.fn() },
    )).rejects.toThrow(/холодный старт GPU-инстанса/)
  })

  it("по-прежнему называет модель и число секунд потолка — не теряет прежнюю диагностику", async () => {
    const fetchImpl = queuedFetch([{ id: "pred_1", status: "processing" }])

    await expect(runReplicateJsonModel(
      "victor-upmeet/whisperx",
      { audio_file: "https://cdn.example.com/a.mp3" },
      config,
      900_000, // 15 минут — реальный потолок спеки, а не искусственный -1
      undefined,
      {
        fetchImpl,
        sleep: vi.fn(),
        now: (() => {
          let call = 0
          // Первый now() — startedAt; второй — проверка дедлайна внутри цикла,
          // сразу заведомо ПОСЛЕ него (900_001мс спустя).
          return () => (call++ === 0 ? 0 : 900_001)
        })(),
      },
    )).rejects.toThrow("victor-upmeet/whisperx не ответила за отведённые ей 900с ожидания")
  })
})

/**
 * Точка 4 задачи: настоящий отказ (мёртвая модель) не должен 15 минут стоять
 * молча — без периодической отметки отказ неотличим от зависания. `onWaiting`
 * зовётся не на каждый опрос (иначе лог шага захлебнулся бы за 15 минут), а
 * раз в {@link WAIT_PROGRESS_LOG_INTERVAL_MS}, и не в момент, когда ответ уже
 * пришёл (иначе лог соврал бы «ещё ждём» про уже готовый результат).
 */
describe("runReplicateJsonModel: прогресс ожидания (onWaiting)", () => {
  it("отчитывается раз в WAIT_PROGRESS_LOG_INTERVAL_MS, а не на каждый опрос", async () => {
    let clock = 0
    const now = () => clock
    // Первый опрос — чуть РАНЬШЕ порога (лога быть не должно), второй —
    // РОВНО на пороге (граница включительно, лог обязан случиться).
    const steps = [WAIT_PROGRESS_LOG_INTERVAL_MS - 1, 1, 1]
    let stepIndex = 0
    const sleep = vi.fn(async () => { clock += steps[stepIndex++]! })

    const fetchImpl = queuedFetch([
      { id: "pred_1", status: "processing" }, // создание задачи
      { id: "pred_1", status: "processing" }, // опрос 1: elapsed = порог-1 — рано
      { id: "pred_1", status: "processing" }, // опрос 2: elapsed = порог — граница, лог
      { id: "pred_1", status: "succeeded", output: { ok: true } }, // опрос 3: финал
    ])

    const onWaiting = vi.fn()

    const result = await runReplicateJsonModel(
      "victor-upmeet/whisperx",
      { audio_file: "https://cdn.example.com/a.mp3" },
      config,
      15 * 60_000,
      undefined,
      { fetchImpl, sleep, now, onWaiting },
    )

    expect(result).toEqual({ ok: true })
    expect(onWaiting).toHaveBeenCalledTimes(1)
    expect(onWaiting).toHaveBeenCalledWith(WAIT_PROGRESS_LOG_INTERVAL_MS)
  })

  it("мутация: интервал не сбрасывается от последнего лога — после первого лога продолжало бы логировать на каждом опросе", async () => {
    // Если реализация меряет elapsed от startedAt вместо lastProgressLogAt,
    // порог "elapsed >= interval" остаётся истинным на КАЖДОМ следующем опросе
    // после первого пересечения — это и ловит счётчик вызовов ниже.
    let clock = 0
    const now = () => clock
    const sleep = vi.fn(async () => { clock += WAIT_PROGRESS_LOG_INTERVAL_MS / 2 })

    const fetchImpl = queuedFetch([
      { id: "pred_1", status: "processing" }, // создание
      { id: "pred_1", status: "processing" }, // +половина порога — рано
      { id: "pred_1", status: "processing" }, // +половина порога — граница, ЛОГ №1
      { id: "pred_1", status: "processing" }, // +половина порога — от последнего лога рано, лога быть НЕ должно
      { id: "pred_1", status: "succeeded", output: { ok: true } }, // финал
    ])

    const onWaiting = vi.fn()

    await runReplicateJsonModel(
      "victor-upmeet/whisperx",
      { audio_file: "https://cdn.example.com/a.mp3" },
      config,
      15 * 60_000,
      undefined,
      { fetchImpl, sleep, now, onWaiting },
    )

    expect(onWaiting).toHaveBeenCalledTimes(1)
    expect(onWaiting).toHaveBeenCalledWith(WAIT_PROGRESS_LOG_INTERVAL_MS)
  })

  it("не шлёт «ещё ждём» в момент, когда предсказание уже завершилось успехом", async () => {
    let clock = 0
    const now = () => clock
    const sleep = vi.fn(async () => { clock += WAIT_PROGRESS_LOG_INTERVAL_MS })

    const fetchImpl = queuedFetch([
      { id: "pred_1", status: "processing" }, // создание
      // Опрос ровно на пороге интервала, но уже с успехом — без защиты по
      // статусу это дало бы ложный лог «ещё ждём» одновременно с готовым ответом.
      { id: "pred_1", status: "succeeded", output: { ok: true } },
    ])

    const onWaiting = vi.fn()

    await runReplicateJsonModel(
      "victor-upmeet/whisperx",
      { audio_file: "https://cdn.example.com/a.mp3" },
      config,
      15 * 60_000,
      undefined,
      { fetchImpl, sleep, now, onWaiting },
    )

    expect(onWaiting).not.toHaveBeenCalled()
  })

  it("onWaiting не передан — опрос идёт как раньше, без ошибок", async () => {
    const fetchImpl = queuedFetch([
      { id: "pred_1", status: "processing" },
      { id: "pred_1", status: "succeeded", output: { ok: true } },
    ])

    const result = await runReplicateJsonModel(
      "victor-upmeet/whisperx",
      { audio_file: "https://cdn.example.com/a.mp3" },
      config,
      15 * 60_000,
      undefined,
      { fetchImpl, sleep: vi.fn() },
    )

    expect(result).toEqual({ ok: true })
  })

  it("onWaiting бросает — прогресс-лог не роняет само ожидание ответа провайдера", async () => {
    const fetchImpl = queuedFetch([
      { id: "pred_1", status: "processing" },
      { id: "pred_1", status: "processing" },
      { id: "pred_1", status: "succeeded", output: { ok: true } },
    ])
    let clock = 0
    const now = () => clock
    const sleep = vi.fn(async () => { clock += WAIT_PROGRESS_LOG_INTERVAL_MS })
    const onWaiting = vi.fn(() => { throw new Error("БД недоступна") })

    const result = await runReplicateJsonModel(
      "victor-upmeet/whisperx",
      { audio_file: "https://cdn.example.com/a.mp3" },
      config,
      15 * 60_000,
      undefined,
      { fetchImpl, sleep, now, onWaiting },
    )

    expect(result).toEqual({ ok: true })
    expect(onWaiting).toHaveBeenCalledTimes(1)
  })
})
