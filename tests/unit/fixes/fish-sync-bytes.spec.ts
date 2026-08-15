/**
 * Ветка `sync_bytes` в раннере медиазадач.
 *
 * Прежние два транспорта отдают ССЫЛКУ: Replicate кладёт выход в хранилище,
 * fal возвращает URL, и оба потом скачиваются. Fish отдаёт байты в теле ответа
 * — скачивать нечего, писать надо сразу.
 *
 * Идемпотентность при этом остаётся общей: повторный прогон той же реплики не
 * должен звать провайдера второй раз.
 */

import { describe, expect, it, vi } from "vitest"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"
import { resolveMediaRoute } from "~~/server/utils/media-provider/registry"

const spec = resolveMediaRoute("text_to_speech", "fish:s2.1-pro-free", {}).primary

const input = {
  text: "Замер бесплатный, но замерщик уедет с готовым расчётом.",
  voiceId: "a41ce4ce7d2f4afe9dac0026b6555bf2",
  speed: 1,
  language: "ru",
  format: "mp3",
}

describe("sync_bytes: аудио пишется из тела ответа", () => {
  it("зовёт провайдера и кладёт байты в outputPath", async () => {
    const writes: Array<{ path: string, size: number }> = []
    const synthesize = vi.fn(async () => ({
      bytes: Buffer.from("аудио-байты"),
      contentType: "audio/mpeg",
    }))

    const result = await runMediaTask({
      capability: "text_to_speech",
      spec,
      input,
      identityScope: "character:liana:line:1",
      unitKey: "scene:1",
      outputPath: "/tmp/line.mp3",
    }, {
      synthesizeBytes: synthesize,
      writeBytes: async (path, bytes) => { writes.push({ path, size: bytes.length }) },
      findPersistedPrediction: async () => null,
    })

    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([{ path: "/tmp/line.mp3", size: Buffer.byteLength("аудио-байты") }])
    expect(result.source).toBe("generated")
    expect(result.localPath).toBe("/tmp/line.mp3")
    expect(result.contentType).toBe("audio/mpeg")
    // Ссылки у провайдера нет — врать про неё нельзя.
    expect(result.remoteUrl).toBeNull()
  })

  it("в провайдера уходит payload по снятой схеме", async () => {
    const synthesize = vi.fn(async () => ({ bytes: Buffer.from("x"), contentType: "audio/mpeg" }))
    await runMediaTask({
      capability: "text_to_speech",
      spec,
      input,
      identityScope: "character:liana:line:2",
      unitKey: "scene:2",
      outputPath: "/tmp/line.mp3",
    }, {
      synthesizeBytes: synthesize,
      writeBytes: async () => {},
      findPersistedPrediction: async () => null,
    })

    const [modelId, payload] = synthesize.mock.calls[0]!
    expect(modelId).toBe("s2.1-pro-free")
    expect(payload).toMatchObject({ reference_id: input.voiceId, format: "mp3" })
  })

  it("повтор той же реплики не зовёт провайдера второй раз", async () => {
    const synthesize = vi.fn()
    const result = await runMediaTask({
      capability: "text_to_speech",
      spec,
      input,
      identityScope: "character:liana:line:1",
      unitKey: "scene:1",
      outputPath: "/tmp/line.mp3",
    }, {
      synthesizeBytes: synthesize,
      writeBytes: async () => {},
      findPersistedPrediction: async () => ({
        id: "pred_1",
        externalId: null,
        persistedStorageKey: "zavodcamp/tts/line.mp3",
      }),
      materializeStorageFile: async () => {},
    })

    expect(result.source).toBe("reused_prediction")
    expect(result.costUsd).toBe(0)
    expect(synthesize).not.toHaveBeenCalled()
  })

  it("готовый файл на диске отменяет вызов вовсе", async () => {
    const synthesize = vi.fn()
    const result = await runMediaTask({
      capability: "text_to_speech",
      spec,
      input,
      unitKey: "scene:1",
      outputPath: "/tmp/line.mp3",
      reuseLocalPath: "/tmp/line.mp3",
    }, {
      synthesizeBytes: synthesize,
      fileExists: async () => true,
    })

    expect(result.source).toBe("reused_asset")
    expect(synthesize).not.toHaveBeenCalled()
  })
})
