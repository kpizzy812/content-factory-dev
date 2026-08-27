/**
 * Мок ветки `sync_json` обязан отвечать ПО СПОСОБНОСТИ.
 *
 * Находка предшественника (отчёт Task 5, пункт 2): `runReplicateJsonModel`
 * в мок-режиме возвращал `{ text, chunks }` независимо от того, кто её позвал.
 * Пока ветку исполняла одна транскрипция, это было незаметно. С появлением
 * `voice_cloning` на той же ветке стенд с `REPLICATE_MOCK_MODE=true` получал бы
 * на клон голоса ТРАНСКРИПТ, не находил `voice_id` — и весь смысл мок-режима
 * («маршрут проходится целиком без единого платного вызова») пропадал именно
 * там, где платный вызов дороже всего, $3.
 *
 * Тот же принцип уже действует в моке Replicate для файловых способностей
 * (`OUTPUT_EXTENSION_BY_CAPABILITY`, `server/utils/replicate/mock.ts`): выход
 * выбирается по capability, а неизвестная способность падает громко, а не
 * получает чужой выход. Здесь — ровно он, только для JSON-выходов.
 */

import { describe, expect, it, vi } from "vitest"

import type { ReplicateConfig } from "../../../server/utils/replicate/config"
import { runReplicateJsonModel } from "../../../server/utils/replicate/json-model"
import { runMediaTask } from "../../../server/utils/media-provider/run-media-task"
import { listMediaSpecs } from "../../../server/utils/media-provider/registry"
import type { VoiceCloningModelSpec } from "../../../server/utils/media-provider/types"

const mockConfig: ReplicateConfig = {
  apiToken: null,
  webhookSigningSecret: null,
  webhookBaseUrl: null,
  webhookUrl: null,
  defaultLipSyncModel: "kwaivgi/kling-lip-sync",
  defaultTtsModel: "minimax/speech-02-turbo",
  mockMode: true,
  recoveryEnabled: true,
  fallbackProvider: null,
}

describe("мок sync_json отвечает по способности", () => {
  it("транскрипции — прежний транскрипт (форма, которую понимает нормализатор)", async () => {
    const fetchImpl = vi.fn()

    const output = await runReplicateJsonModel(
      "vaibhavs10/incredibly-fast-whisper",
      { audio: "https://cdn.example.com/a.mp3" },
      mockConfig,
      5_000,
      undefined,
      { fetchImpl, capability: "transcription" },
    )

    expect(output).toMatchObject({ text: expect.any(String) })
    expect((output as { chunks: unknown[] }).chunks.length).toBeGreaterThan(0)
    // Мок офлайн: сети быть не должно вовсе.
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("клону голоса — структура с voice_id, а не транскрипт", async () => {
    const output = await runReplicateJsonModel(
      "minimax/voice-cloning",
      { voice_file: "https://cdn.example.com/sample.mp3", model: "speech-02-turbo" },
      mockConfig,
      5_000,
      undefined,
      { capability: "voice_cloning" },
    )

    expect(output).toMatchObject({ voice_id: expect.any(String) })
    expect((output as { voice_id: string }).voice_id.trim().length).toBeGreaterThan(0)
    expect(output).not.toHaveProperty("chunks")
  })

  it("способность мока неизвестна — падает громко, а не отдаёт чужой выход", async () => {
    await expect(runReplicateJsonModel(
      "some/model",
      {},
      mockConfig,
      5_000,
      undefined,
      { capability: "image_to_image" },
    )).rejects.toThrow(/мок/i)

    // Способность не передали вовсе — та же ошибка: молча отдать транскрипт
    // значит вернуть его тому, кто просил не транскрипт.
    await expect(runReplicateJsonModel("some/model", {}, mockConfig, 5_000))
      .rejects.toThrow(/мок/i)
  })
})

describe("способность доезжает от спеки до раннера", () => {
  it("runMediaTask передаёт spec.capability в runJsonModel", async () => {
    const spec = listMediaSpecs("voice_cloning")[0] as VoiceCloningModelSpec
    const runJsonModel = vi.fn(async () => ({ voice_id: "R8_X" }))

    await runMediaTask({
      capability: "voice_cloning",
      spec,
      input: { audioUrl: "https://cdn.example.com/sample.mp3", targetModel: "speech-02-turbo" },
      identityScope: "character:char_1:voice-clone:speech-02-turbo",
      unitKey: "voice-clone",
      outputPath: "/tmp/ignored-voice-clone.json",
    }, {
      runJsonModel,
      // Мок-режим провайдера: гейт платных вызовов пропускает, наружу ничего не уходит.
      replicateConfig: mockConfig,
      writeBytes: async () => {},
      findPersistedPrediction: async () => null,
      savePrediction: async () => null,
    })

    expect(runJsonModel).toHaveBeenCalledTimes(1)
    const call = runJsonModel.mock.calls[0]! as unknown as unknown[]
    expect(call[0]).toBe("minimax/voice-cloning")
    // Способность — последним аргументом, чтобы прежние вызывающие не поехали.
    expect(call[5]).toBe("voice_cloning")
  })
})
