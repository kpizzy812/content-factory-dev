/**
 * Денежная логика адаптера `requestTranscription` (ревью Task 6, находка 2):
 * выбор спеки через `resolveMediaRoute` (без обхода гейта `integrated`),
 * проверка потолка длительности ДО платного вызова, обязательный `videoId`,
 * ключ хранилища в `persist`. `runMediaTask` и `probeAudioDuration` замоканы —
 * `resolveMediaRoute` НЕ замокан: сам гейт (находка 1) проверяется на
 * настоящей реализации, а не на её имитации.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isTranscriptionRouteAvailable, requestTranscription } from "~~/server/utils/transcription/media-task"
import { StorageKeys } from "~~/server/utils/storage/keys"

const h = vi.hoisted(() => ({
  runMediaTask: vi.fn(),
  probeAudioDuration: vi.fn(),
}))

// vi.mock хойстится вверх файла самим vitest — порядок относительно импортов
// выше не важен, но декларативно держим моки рядом с h для читаемости.
vi.mock("~~/server/utils/media-provider/run-media-task", () => ({ runMediaTask: h.runMediaTask }))
vi.mock("~~/server/utils/tts", () => ({ probeAudioDuration: h.probeAudioDuration }))

const INPUT = {
  videoId: 7,
  stepId: 3,
  // Только локальный файл: адрес провайдеру больше не передаётся ссылкой из
  // хранилища — `runMediaTask` сам заливает БАЙТЫ файла (inputUploads), как
  // это уже делают lip-sync и аватарный маршрут (canary 26.08.2026: локальный
  // driver хранилища отдаёт ОТНОСИТЕЛЬНЫЙ путь, Replicate его не скачивает —
  // 422 при создании задачи).
  audioPath: "/tmp/voiceover.mp3",
  language: "ru",
  outputPath: "/tmp/transcript.json",
}

const ENV_KEY = "MEDIA_MODEL_TRANSCRIPTION"

describe("requestTranscription: маршрут, потолок длительности, идемпотентность", () => {
  const original = process.env[ENV_KEY]

  beforeEach(() => {
    delete process.env[ENV_KEY]
    h.runMediaTask.mockReset()
    h.probeAudioDuration.mockReset()
  })

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original
  })

  it("без env-оверрайда модель integrated:false — отказ ДО обращения к провайдеру", async () => {
    h.probeAudioDuration.mockResolvedValue(12)

    await expect(requestTranscription(INPUT)).rejects.toThrow(/transcription/i)

    // Гейт срабатывает раньше любого платного или диагностического действия.
    expect(h.probeAudioDuration).not.toHaveBeenCalled()
    expect(h.runMediaTask).not.toHaveBeenCalled()
  })

  it("явный env-оверрайд включает модель — spec.id и usage.audioSeconds уходят в runMediaTask", async () => {
    process.env[ENV_KEY] = "openai/whisper"
    h.probeAudioDuration.mockResolvedValue(12.34)
    h.runMediaTask.mockResolvedValue({ costUsd: 0.0025, raw: { words: [] } })

    const result = await requestTranscription(INPUT)

    expect(h.runMediaTask).toHaveBeenCalledTimes(1)
    const call = h.runMediaTask.mock.calls[0]![0] as Record<string, unknown>
    expect((call.spec as { id: string }).id).toBe("openai/whisper")
    expect(call.usage).toEqual({ audioSeconds: 12.34 })
    // Без videoId нет ключа идемпотентности — повтор оплатил бы задачу заново.
    expect(call.videoId).toBe(7)
    expect(call.stepId).toBe(3)
    expect(call.persist).toMatchObject({
      storageKey: StorageKeys.videoTranscript(7),
      contentType: "application/json",
    })
    // Ссылки из хранилища больше нет: локальный файл трека объявлен как
    // inputUploads — заливает и подставляет URL сам runMediaTask
    // (server/utils/media-provider/run-media-task.ts, prepareInputs),
    // ровно как это уже делает lip-sync/аватарный маршрут.
    expect(call.inputUploads).toEqual([
      { field: "audioUrl", path: INPUT.audioPath, contentType: "audio/mpeg" },
    ])
    expect((call.input as Record<string, unknown>).audioUrl).toBe("")
    expect(result).toEqual({ costUsd: 0.0025, raw: { words: [] } })
  })

  it("трек длиннее maxDurationSec отклоняется до платного вызова", async () => {
    process.env[ENV_KEY] = "openai/whisper"
    // Модель Whisper ограничена 600с (server/utils/media-provider/model-specs.ts).
    h.probeAudioDuration.mockResolvedValue(601)

    await expect(requestTranscription(INPUT)).rejects.toThrow(/600/)

    expect(h.runMediaTask).not.toHaveBeenCalled()
  })

  it("длительность 0 (ffprobe не прочитал файл) отклоняется до платного вызова", async () => {
    process.env[ENV_KEY] = "openai/whisper"
    h.probeAudioDuration.mockResolvedValue(0)

    await expect(requestTranscription(INPUT)).rejects.toThrow(/длительность/)

    expect(h.runMediaTask).not.toHaveBeenCalled()
  })

  describe("гейт маршрута: исполнима ли транскрипция вообще", () => {
    it("без настроенной модели — нет, и оркестратор уведёт ролик прежним маршрутом", () => {
      expect(isTranscriptionRouteAvailable()).toBe(false)
    })

    it("с env-оверрайдом — да", () => {
      process.env[ENV_KEY] = "openai/whisper"

      expect(isTranscriptionRouteAvailable()).toBe(true)
    })

    it("правило то же, что у самого адаптера — иначе гейт и вызов разойдутся", async () => {
      // Гейт говорит «нельзя» ровно там, где `requestTranscription` бросает
      // до провайдера: одна и та же `resolveMediaRoute` без requestedId.
      expect(isTranscriptionRouteAvailable()).toBe(false)
      h.probeAudioDuration.mockResolvedValue(12)
      await expect(requestTranscription(INPUT)).rejects.toThrow(/transcription/i)
    })
  })
})
