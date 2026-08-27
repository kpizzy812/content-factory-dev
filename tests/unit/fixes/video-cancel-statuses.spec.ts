/**
 * Что оператор вправе отменить — и почему список именно такой.
 *
 * ДЫРА (открытый вопрос `tariff-and-stepwise-tails-report.md` §«Открытые
 * вопросы», п.1). При переносе списка отменяемых статусов из
 * `server/api/videos/[id]/cancel.post.ts` в политику выяснилось, что
 * `generating_voiceover` и `configuring` есть в `RESUMABLE_VIDEO_STATUSES`, но
 * в отменяемых их не было НИКОГДА. То есть ролик, который watchdog вправе
 * поднять ЗА НАШИ ДЕНЬГИ, оператор остановить не мог. Для
 * `generating_voiceover` это ещё и самый длинный шаг маршрута «монтаж от
 * звука»: под этим статусом идут и синтез трека, и ТРАНСКРИПЦИЯ (GPU-модель на
 * L40S, `video-pipeline-steps.ts:2405` ставит тот же статус с
 * `currentStep: "transcription"`).
 *
 * ЧТО ОТМЕНА РЕАЛЬНО ОСВОБОЖДАЕТ — проверено по коду, а не по общим
 * соображениям (`cancelVideoPipeline`, `server/utils/video-pipeline.ts`):
 *
 *  1. `cancelReplicatePredictionsForVideo(videoId)` находит живые
 *     `MediaPrediction` этого ролика (`starting`/`processing`, `externalId`
 *     непустой) и зовёт `provider.cancel(externalId)`. Под `generating_voiceover`
 *     туда попадает TTS на `execution: "async_prediction"`
 *     (`replicate:minimax-speech-02-turbo`): счётчик GPU-секунд у провайдера
 *     останавливается по-настоящему.
 *  2. Живые шаги с `falRequestId` гасятся `falCancel(endpoint, requestId)` —
 *     это TTS на `sync_queue` (kokoro/playai/elevenlabs через fal).
 *  3. Шаги в `running`/`queued`/`pending` переводятся в `canceled`, ролик — в
 *     `canceled`, блокировка снимается `forceReleaseLock`.
 *
 * ЧЕГО ОТМЕНА НЕ ОСВОБОЖДАЕТ, и это честно сказано здесь, а не замолчано:
 * синхронный вызов, уже ушедший наружу. Fish (`execution: "sync_bytes"`, голос
 * маршрута audio-first) и транскрипция (`execution: "sync_json"`) — блокирующие
 * HTTP-вызовы; `MediaPrediction` для `sync_json` пишется ПОСЛЕ ответа
 * (`run-media-task.ts`, ветка sync_json → `savePrediction` в конце), отменять
 * на стороне провайдера нечего. Цена этого окна — ОДИН вызов: трек синтезируется
 * одним обращением, транскрипция тоже. Это ровно та же плата, что уже принята
 * для `generating_clips`, и она несопоставима с ценой запрета отмены —
 * посценный TTS делает вызов НА КАЖДУЮ сцену, и без кнопки оператор оплачивал
 * их все.
 *
 * Прервать сам цикл прогона отмена по-прежнему может только через AbortSignal
 * (реестр в `pipeline-cancel-registry.ts` ключуется по `runId` воркфлоу, не по
 * videoId). Это ОБЩЕЕ свойство отмены на всех статусах без исключения, а не
 * особенность озвучки: `generating_clips` живёт с ним столько же. Поэтому оно
 * не довод против кнопки, и чинится отдельно, если чинится.
 */
import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import {
  CANCELABLE_VIDEO_STATUSES,
  RESUMABLE_VIDEO_STATUSES,
} from "../../../server/utils/video-pipeline-run-policy"

/** Статусы, за которыми прогона нет: останавливать там нечего. */
const TERMINAL_STATUSES = ["completed", "failed", "timeout", "canceled", "file_missing"] as const

/**
 * Все значения `VideoStatus` — из схемы, а не из списка в тесте.
 *
 * Иначе новый статус, добавленный миграцией, тихо не попал бы ни в один список
 * и оказался бы ровно в том положении, в котором были `generating_voiceover` и
 * `configuring`: ролик есть, кнопки нет.
 */
async function videoStatusesFromSchema(): Promise<string[]> {
  const schema = await readFile("prisma/schema.prisma", "utf-8")
  const block = /enum VideoStatus \{([\s\S]*?)\}/.exec(schema)
  expect(block, "в схеме не найден enum VideoStatus").toBeTruthy()
  return block![1]!
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("///") && !line.startsWith("//"))
}

describe("отменяемые статусы ролика", () => {
  it("синтез речи отменяем: длинный и дорогой шаг обязан иметь стоп-кран", () => {
    // Под этим статусом идут посценный TTS (вызов на каждую сцену), синтез
    // единого трека и транскрипция. Без отмены оператор, увидевший брак в
    // сценарии на первой же сцене, оплачивал озвучку всех остальных.
    expect(CANCELABLE_VIDEO_STATUSES).toContain("generating_voiceover")
  })

  it("configuring отменяем: возобновляемое обязано быть останавливаемым", () => {
    // Сам статус мёртвый — по всей истории репозитория его никто не ПИШЕТ
    // (проверено `git log -S`), он остался от миграции
    // 20260407082918_add_video_steps_upload_attempts. Но он есть в
    // RESUMABLE_VIDEO_STATUSES, а значит watchdog вправе поднять такую строку
    // (легаси-запись в боевой БД) за наши деньги. Право поднять без права
    // остановить — это асимметрия, а не экономия.
    expect(CANCELABLE_VIDEO_STATUSES).toContain("configuring")
  })

  it("всё, что watchdog вправе поднять за деньги, оператор вправе остановить", () => {
    // Главный инвариант этой правки и её же защита от повторения: RESUMABLE ⊆
    // CANCELABLE. Обратное включение НЕ требуется — `awaiting_operator`
    // отменяем, но не возобновляем: он ждёт человека, а не висит.
    for (const status of RESUMABLE_VIDEO_STATUSES) {
      expect(CANCELABLE_VIDEO_STATUSES, `статус ${status} возобновляем, но не отменяем`)
        .toContain(status)
    }
  })

  it("терминальные статусы не отменяются: за ними прогона нет", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(CANCELABLE_VIDEO_STATUSES).not.toContain(status)
      expect(RESUMABLE_VIDEO_STATUSES).not.toContain(status)
    }
  })

  it("каждый статус схемы либо терминальный, либо отменяемый — третьего нет", async () => {
    const statuses = await videoStatusesFromSchema()
    expect(statuses.length).toBeGreaterThan(0)

    for (const status of statuses) {
      const terminal = (TERMINAL_STATUSES as readonly string[]).includes(status)
      const cancelable = CANCELABLE_VIDEO_STATUSES.includes(status)
      expect(
        terminal !== cancelable,
        `статус ${status}: терминальный=${terminal}, отменяемый=${cancelable} — `
        + "ролик без выхода либо отмена того, чего нет",
      ).toBe(true)
    }
  })

  it("ручка отмены не держит своего списка", async () => {
    // Инлайновый список в ручке — это ровно то, из-за чего дыра прожила так
    // долго: тестом до него не дотянуться без поднятого Nuxt.
    const source = await readFile("server/api/videos/[id]/cancel.post.ts", "utf-8")

    expect(source).toMatch(/CANCELABLE_VIDEO_STATUSES/)
    expect(source).not.toMatch(/"generating_clips"|'generating_clips'/)
  })
})
