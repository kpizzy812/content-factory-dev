/**
 * `replicate:whisperx` через ветку sync_json раннера — версия и payload
 * обязаны дойти до `runJsonModel` в РЕАЛЬНОМ виде схемы модели: `audio_file`
 * (не `audio`), `align_output: true`, хеш версии — ЗАХАРДКОЖЕННЫЙ в тесте, а
 * не взятый из `spec.providerVersion` (иначе сравнение с самим собой прошло
 * бы даже при поломанном раннере — см. `transcription-sync-json.spec.ts`
 * рядом, тот же приём для `openai/whisper`).
 */

import { describe, expect, it, vi } from "vitest"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"
import { findMediaSpec } from "~~/server/utils/media-provider/registry"

const spec = findMediaSpec("replicate:whisperx")
if (!spec || spec.capability !== "transcription") {
  throw new Error("тест ожидает зарегистрированную спеку replicate:whisperx")
}
if (spec.billing.unit !== "hardware_second") throw new Error("тест ожидает тариф hardware_second")
const expectedCostUsd = spec.billing.estimatedSeconds * spec.billing.usdPerSecond

const input = {
  audioUrl: "https://cdn.example.com/voiceover.mp3",
  language: "ru",
}

describe("sync_json: replicate:whisperx доезжает до раннера с версией и правильным payload", () => {
  it("зовёт провайдера один раз с audio_file/align_output и версией модели", async () => {
    const raw = {
      segments: [
        { text: "привет мир", start: 0, end: 0.9, words: [
          { word: "привет", start: 0, end: 0.42, score: 0.9 },
          { word: "мир", start: 0.42, end: 0.9, score: 0.87 },
        ] },
      ],
      detected_language: "ru",
    }
    const runJsonModel = vi.fn(async () => raw)
    const writes: Array<{ path: string, content: string }> = []

    const result = await runMediaTask({
      capability: "transcription",
      spec,
      input,
      identityScope: "video:1:scene:1:transcription-whisperx",
      unitKey: "scene:1",
      outputPath: "/tmp/transcript-whisperx.json",
      usage: { audioSeconds: 42 },
    }, {
      runJsonModel,
      writeBytes: async (path, bytes) => { writes.push({ path, content: bytes.toString("utf8") }) },
      findPersistedPrediction: async () => null,
      requirePaidApis: () => {},
    })

    expect(runJsonModel).toHaveBeenCalledTimes(1)
    const [modelId, payload, timeoutMs, version] = runJsonModel.mock.calls[0]!
    expect(modelId).toBe("victor-upmeet/whisperx")
    expect(payload).toEqual({
      audio_file: input.audioUrl,
      language: "ru",
      align_output: true,
    })
    expect(timeoutMs).toBe(spec.timeoutMs)
    // Хеш версии — последняя версия модели, сверена 26.08.2026 напрямую с
    // https://replicate.com/api/models/victor-upmeet/whisperx/versions.
    expect(version).toBe("655845d6190ef70573c669245f245892cd039df4b880a1e3a65852c09252f5cc")

    expect(writes).toEqual([{ path: "/tmp/transcript-whisperx.json", content: JSON.stringify(raw) }])
    expect(result.raw).toEqual(raw)
    expect(result.costUsd).toBeCloseTo(expectedCostUsd, 10)
  })
})
