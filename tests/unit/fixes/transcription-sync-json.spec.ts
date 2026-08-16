/**
 * Ветка `sync_json` в раннере медиазадач.
 *
 * Так же как `sync_bytes` (Fish Audio) у sync_json нет промежуточной ссылки на
 * файл — но, в отличие от него, результат не байты, а СТРУКТУРА (слова и
 * границы транскрипции). Раннер сериализует её в `outputPath`, а при
 * переиспользовании обязан прочитать её обратно: без `raw` вызывающий получил
 * бы «успех» с пустыми руками, хотя за задачу уже заплачено.
 *
 * Спека берётся напрямую через `listMediaSpecs("transcription")[0]`, а не через
 * `resolveMediaRoute`: модель `integrated: false` (цена не подтверждена
 * страницей модели), маршрут её не отдаст без явного запроса.
 */

import { describe, expect, it, vi } from "vitest"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"
import { listMediaSpecs } from "~~/server/utils/media-provider/registry"

const spec = listMediaSpecs("transcription")[0]!
if (spec.billing.unit !== "audio_second") throw new Error("тест ожидает тариф audio_second")
const usdPerSecond = spec.billing.usdPerSecond

const input = {
  audioUrl: "https://cdn.example.com/voiceover.mp3",
  language: "ru",
}

describe("sync_json: транскрипция пишет структуру, а не файл", () => {
  it("сохранённого результата нет — зовёт провайдера один раз, пишет JSON и возвращает raw", async () => {
    const raw = { text: "привет мир", chunks: [{ text: "привет мир", timestamp: [0, 0.9] }] }
    const runJsonModel = vi.fn(async () => raw)
    const writes: Array<{ path: string, content: string }> = []

    const result = await runMediaTask({
      capability: "transcription",
      spec,
      input,
      identityScope: "video:1:scene:1:transcription",
      unitKey: "scene:1",
      outputPath: "/tmp/transcript.json",
      usage: { audioSeconds: 42 },
    }, {
      runJsonModel,
      writeBytes: async (path, bytes) => { writes.push({ path, content: bytes.toString("utf8") }) },
      findPersistedPrediction: async () => null,
      requirePaidApis: () => {},
    })

    expect(runJsonModel).toHaveBeenCalledTimes(1)
    const [modelId, payload, timeoutMs] = runJsonModel.mock.calls[0]!
    expect(modelId).toBe(spec.id)
    expect(payload).toMatchObject({ audio: input.audioUrl, language: "ru" })
    expect(timeoutMs).toBe(spec.timeoutMs)

    expect(writes).toEqual([{ path: "/tmp/transcript.json", content: JSON.stringify(raw) }])
    expect(result.source).toBe("generated")
    expect(result.contentType).toBe("application/json")
    expect(result.raw).toEqual(raw)
    // Цена не выводится из входа (deriveUsage у transcription отдаёт {}) — считается
    // строго по usage, который передал вызывающий.
    expect(result.costUsd).toBeCloseTo(42 * usdPerSecond, 10)
  })

  it("сохранённый результат уже есть — провайдера не зовёт второй раз, raw читает из хранилища", async () => {
    const stored = { text: "старая транскрипция", chunks: [] as unknown[] }
    const runJsonModel = vi.fn()

    const result = await runMediaTask({
      capability: "transcription",
      spec,
      input,
      identityScope: "video:1:scene:1:transcription",
      unitKey: "scene:1",
      outputPath: "/tmp/transcript.json",
    }, {
      runJsonModel,
      findPersistedPrediction: async () => ({
        id: "pred_1",
        externalId: null,
        persistedStorageKey: "zavodcamp/transcripts/scene-1.json",
      }),
      materializeStorageFile: async () => {},
      readTextFile: async () => JSON.stringify(stored),
    })

    expect(runJsonModel).not.toHaveBeenCalled()
    expect(result.source).toBe("reused_prediction")
    // За уже оплаченную задачу второй раз не платят.
    expect(result.costUsd).toBe(0)
    expect(result.raw).toEqual(stored)
  })

  it("сохранённый JSON повреждён — падает честно, а не отдаёт успех с пустыми руками и не платит второй раз", async () => {
    const runJsonModel = vi.fn()

    await expect(runMediaTask({
      capability: "transcription",
      spec,
      input,
      identityScope: "video:1:scene:1:transcription",
      unitKey: "scene:1",
      outputPath: "/tmp/transcript.json",
    }, {
      runJsonModel,
      findPersistedPrediction: async () => ({
        id: "pred_1",
        externalId: null,
        persistedStorageKey: "zavodcamp/transcripts/scene-1.json",
      }),
      materializeStorageFile: async () => {},
      readTextFile: async () => "{ битый json",
    })).rejects.toThrow(/сохранённый результат повреждён/)

    // Ни фальшивого успеха, ни повторной оплаты: провайдер не вызывается вовсе.
    expect(runJsonModel).not.toHaveBeenCalled()
  })
})
