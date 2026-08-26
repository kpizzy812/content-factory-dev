/**
 * Стенд 26.08.2026: транскрипция дважды подряд упала «Транскрипция: модель
 * victor-upmeet/whisperx не ответила за 300с», хотя тремя часами раньше та же
 * модель на том же треке отработала успешно — шаг стоил $0.0182, что совпадает
 * с тарифом из спеки (A100, ~13с работы).
 *
 * Ограничивал НАШ потолок ожидания: `REPLICATE_WHISPERX.timeoutMs`
 * (`server/utils/media-provider/model-specs.ts`), а не сама модель.
 * `runReplicateJsonModel` (`server/utils/replicate/json-model.ts`) считает
 * дедлайн ровно из этого поля; опрос идёт каждые 2с (`POLL_INTERVAL_MS`) —
 * этот интервал задаёт только частоту запросов, не потолок. У опроса нет
 * собственного отдельного лимита времени: единственная граница — та, что
 * пришла аргументом `timeoutMs` из спеки. 300с оказались тесны для холодного
 * старта Nvidia A100 (80GB), на котором крутится модель: инстанс
 * масштабируется в ноль, разогрев занимает минуты, плюс возможна очередь на
 * стороне Replicate — реальная работа (~13с) в эти 300с почти не входит.
 *
 * Этот файл покрывает две половины фикса:
 *  1. `REPLICATE_WHISPERX.timeoutMs` поднят до 15 минут — не наугад, а
 *     вровень с `KLING_LIP_SYNC`/`FAL_SYNC_LIPSYNC`, другим Replicate-контуром
 *     с тем же профилем «секунды работы, холодный старт может занять минуты».
 *  2. Ветка `sync_json` в `runMediaTask` пробрасывает прогресс ожидания
 *     (`onWaiting` из `runReplicateJsonModel`) в лог шага через `appendStepLog`
 *     — без этого честный отказ мёртвой модели 15 минут выглядел бы для
 *     оператора неотличимым от зависания.
 */

import { describe, expect, it, vi } from "vitest"
import { MEDIA_MODEL_SPECS } from "~~/server/utils/media-provider/model-specs"
import { listMediaSpecs } from "~~/server/utils/media-provider/registry"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"

function specByKey(registryKey: string) {
  const spec = MEDIA_MODEL_SPECS.find(s => s.registryKey === registryKey)
  if (!spec) throw new Error(`спека ${registryKey} не найдена в реестре — тест ожидает её наличия`)
  return spec
}

describe("REPLICATE_WHISPERX: потолок ожидания поднят под холодный старт A100", () => {
  it("timeoutMs — 15 минут, а не прежние 5", () => {
    expect(specByKey("replicate:whisperx").timeoutMs).toBe(15 * 60_000)
  })

  it("не выбивается из ряда: тот же потолок, что у lip-sync — другого Replicate-контура с холодным GPU-стартом", () => {
    // Kling Lip Sync — тоже async_prediction на Replicate с реальной работой
    // в секундах-минутах и тем же риском холодного старта; 15 минут там уже
    // стоят и проверены практикой. Значение WhisperX выбрано вровень, не с потолка.
    expect(specByKey("replicate:whisperx").timeoutMs).toBe(specByKey("replicate:kling-lip-sync").timeoutMs)
    expect(specByKey("replicate:whisperx").timeoutMs).toBe(specByKey("fal:sync-lipsync").timeoutMs)
  })

  it("REPLICATE_WHISPER (T4, непригодна для маршрута) не тронута — свой потолок другой способности", () => {
    // §«не трогай потолки других способностей без причины»: Whisper работает
    // на другом железе (Nvidia T4), помечена integrated:false и по факту
    // непригодна для маршрута «монтаж от звука» (нет пословных таймингов) —
    // поднимать её потолок незачем.
    expect(specByKey("replicate:whisper").timeoutMs).toBe(5 * 60_000)
  })
})

describe("runMediaTask (sync_json): прогресс ожидания уходит в лог шага транскрипции", () => {
  const spec = listMediaSpecs("transcription")[0]!

  function baseRequest(stepId?: number) {
    return {
      capability: "transcription" as const,
      spec,
      input: { audioUrl: "https://cdn.example.com/track.mp3", language: "ru" },
      unitKey: "transcript",
      outputPath: "/tmp/transcript.json",
      usage: { audioSeconds: 12 },
      ...(stepId !== undefined ? { stepId } : {}),
    }
  }

  it("stepId задан — runJsonModel получает onWaiting, и вызов пишет в appendStepLog с elapsed/потолком", async () => {
    const appendStepLog = vi.fn(async () => {})
    let capturedOnWaiting: ((elapsedMs: number) => void | Promise<void>) | undefined

    const runJsonModel = vi.fn(async (_modelId: string, _payload: unknown, _timeoutMs: number, _version: string | undefined, onWaiting: typeof capturedOnWaiting) => {
      capturedOnWaiting = onWaiting
      return { text: "раз", chunks: [{ text: "раз", timestamp: [0, 1] }] }
    })

    await runMediaTask(baseRequest(777), {
      runJsonModel,
      writeBytes: async () => {},
      requirePaidApis: () => {},
      appendStepLog,
    })

    expect(runJsonModel).toHaveBeenCalledTimes(1)
    expect(typeof capturedOnWaiting).toBe("function")

    await capturedOnWaiting!(90_000)

    expect(appendStepLog).toHaveBeenCalledTimes(1)
    const [stepId, message] = appendStepLog.mock.calls[0]!
    expect(stepId).toBe(777)
    // Сообщение обязано нести И сколько уже прождали, И сам потолок из спеки —
    // без второго числа оператор не поймёт, сколько ещё осталось.
    expect(message).toContain("90")
    expect(message).toContain(String(Math.round(spec.timeoutMs / 1000)))
  })

  it("stepId не задан — onWaiting не передаётся: писать прогресс некуда", async () => {
    const runJsonModel = vi.fn(async () => ({ text: "раз", chunks: [] as unknown[] }))

    await runMediaTask(baseRequest(undefined), {
      runJsonModel,
      writeBytes: async () => {},
      requirePaidApis: () => {},
    })

    const call = runJsonModel.mock.calls[0]!
    expect(call[4]).toBeUndefined()
  })

  it("appendStepLog падает — прогресс-лог не роняет саму задачу транскрипции", async () => {
    let capturedOnWaiting: ((elapsedMs: number) => void | Promise<void>) | undefined
    const runJsonModel = vi.fn(async (_m: string, _p: unknown, _t: number, _v: string | undefined, onWaiting: typeof capturedOnWaiting) => {
      capturedOnWaiting = onWaiting
      return { text: "раз", chunks: [] as unknown[] }
    })

    await runMediaTask(baseRequest(777), {
      runJsonModel,
      writeBytes: async () => {},
      requirePaidApis: () => {},
      appendStepLog: async () => { throw new Error("БД недоступна") },
    })

    await expect(capturedOnWaiting!(90_000)).resolves.toBeUndefined()
  })
})
