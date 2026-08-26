/**
 * `replicate:incredibly-fast-whisper` через ветку sync_json раннера — версия и
 * payload обязаны дойти до `runJsonModel` в РЕАЛЬНОМ виде схемы модели: `audio`
 * (не `audio_file`), `timestamp: "word"`, `language` ПОЛНЫМ ИМЕНЕМ ("russian",
 * не "ru"), хеш версии — ЗАХАРДКОЖЕННЫЙ в тесте, а не взятый из
 * `spec.providerVersion` (иначе сравнение с самим собой прошло бы даже при
 * поломанном раннере — тот же приём, что у `transcription-whisperx-sync-json.spec.ts`
 * и `transcription-sync-json.spec.ts` рядом).
 *
 * Форма ответа модели (`raw` ниже) — НЕ угадана: снята из исходников
 * (`chenxwh/insanely-fast-whisper/predict.py`, HF `transformers` пайплайна
 * automatic-speech-recognition и `tokenization_whisper.py::_decode_asr` /
 * `_collate_word_timestamps`, см. докстринг спеки в `model-specs.ts` и
 * `tests/unit/transcription/normalize.spec.ts` — полная сверка).
 */

import { describe, expect, it, vi } from "vitest"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"
import { findMediaSpec } from "~~/server/utils/media-provider/registry"

const spec = findMediaSpec("replicate:incredibly-fast-whisper")
if (!spec || spec.capability !== "transcription") {
  throw new Error("тест ожидает зарегистрированную спеку replicate:incredibly-fast-whisper")
}
if (spec.billing.unit !== "hardware_second") throw new Error("тест ожидает тариф hardware_second")
const expectedCostUsd = spec.billing.estimatedSeconds * spec.billing.usdPerSecond

const input = {
  audioUrl: "https://cdn.example.com/voiceover.mp3",
  language: "ru",
}

describe("sync_json: replicate:incredibly-fast-whisper доезжает до раннера с версией и правильным payload", () => {
  it("зовёт провайдера один раз с audio/timestamp:word/language=russian и версией модели", async () => {
    // Реальная форма выхода pipeline(..., return_timestamps="word"): плоский
    // список слов в chunks, каждое — {text, timestamp: [start, end]}.
    const raw = {
      text: " привет мир",
      chunks: [
        { text: " привет", timestamp: [0, 0.42] },
        { text: " мир", timestamp: [0.42, 0.9] },
      ],
    }
    const runJsonModel = vi.fn(async () => raw)
    const writes: Array<{ path: string, content: string }> = []

    const result = await runMediaTask({
      capability: "transcription",
      spec,
      input,
      identityScope: "video:1:scene:1:transcription-incredibly-fast-whisper",
      unitKey: "scene:1",
      outputPath: "/tmp/transcript-ifw.json",
      usage: { audioSeconds: 42 },
    }, {
      runJsonModel,
      writeBytes: async (path, bytes) => { writes.push({ path, content: bytes.toString("utf8") }) },
      findPersistedPrediction: async () => null,
      requirePaidApis: () => {},
    })

    expect(runJsonModel).toHaveBeenCalledTimes(1)
    const [modelId, payload, timeoutMs, version] = runJsonModel.mock.calls[0]!
    expect(modelId).toBe("vaibhavs10/incredibly-fast-whisper")
    expect(payload).toEqual({
      audio: input.audioUrl,
      language: "russian",
      timestamp: "word",
    })
    expect(timeoutMs).toBe(spec.timeoutMs)
    // Хеш версии — последняя версия модели (created_at 2024-02-16), сверена
    // 27.08.2026 напрямую с https://replicate.com/api/models/vaibhavs10/incredibly-fast-whisper/versions.
    expect(version).toBe("3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c")

    expect(writes).toEqual([{ path: "/tmp/transcript-ifw.json", content: JSON.stringify(raw) }])
    expect(result.raw).toEqual(raw)
    expect(result.costUsd).toBeCloseTo(expectedCostUsd, 10)
  })
})
