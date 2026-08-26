/**
 * Canary «монтаж от звука» 26.08.2026 (3-й прогон, транскрипция): Replicate
 * ответил 422 при СОЗДАНИИ задачи — "Транскрипция не дала границ слов
 * (Транскрипция: Replicate ответил 422 при создании задачи)". Причина:
 * `runVideoTranscription` отдавал провайдеру ссылку из
 * `getStorageDriver().getSignedDownloadUrl(...)`, а ЛОКАЛЬНЫЙ драйвер
 * хранилища возвращает ОТНОСИТЕЛЬНЫЙ путь (`/api/files/...`) — Replicate не
 * может его скачать.
 *
 * Lip-sync и аватарный маршрут этой болезни не знают: они не передают
 * ссылок, а заливают БАЙТЫ файла через `inputUploads`/`prepareInputs`
 * (`server/utils/avatar-source.ts`). Ветка `sync_json` (Replicate-
 * транскрипция) формально тоже зовёт `prepareInputs`, но `upload`-колбэк,
 * который ей передавали, был заглушкой:
 *   `async () => { throw new Error("... заливка входных файлов этой веткой
 *   не поддерживается") }`
 * — то есть ЛЮБОЙ `inputUploads` для sync_json падал СРАЗУ. Этот файл ловит
 * именно это: `inputUploads` для sync_json обязан реально заливать файл
 * Replicate, а не падать и не молчать.
 */

import { describe, expect, it, vi } from "vitest"
import { findMediaSpec } from "~~/server/utils/media-provider/registry"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"

const spec = findMediaSpec("replicate:whisperx")
if (!spec || spec.capability !== "transcription") {
  throw new Error("тест ожидает зарегистрированную спеку replicate:whisperx")
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    capability: "transcription" as const,
    spec,
    // audioUrl — заглушка: реальный адрес подставит prepareInputs после
    // заливки локального файла (см. server/utils/avatar-source.ts, тот же приём).
    input: { audioUrl: "", language: "ru" },
    inputUploads: [
      { field: "audioUrl", path: "/tmp/voiceover_track.mp3", contentType: "audio/mpeg" },
    ],
    videoId: 44,
    unitKey: "transcript",
    outputPath: "/tmp/transcript-whisperx.json",
    usage: { audioSeconds: 12 },
    ...overrides,
  }
}

describe("sync_json: заливка локального файла через inputUploads вместо ссылки из хранилища", () => {
  it("файл реально заливается провайдеру, и в payload уходит адрес заливки, а не локальный путь", async () => {
    const uploadReplicateInput = vi.fn(async (path: string) => ({
      id: "file_1",
      url: `https://api.replicate.com/v1/files/${path.split("/").pop()}`,
    }))
    const deleteReplicateInput = vi.fn(async () => {})
    const runJsonModel = vi.fn(async () => ({ segments: [], detected_language: "ru" }))

    const result = await runMediaTask(baseRequest(), {
      uploadReplicateInput,
      deleteReplicateInput,
      runJsonModel,
      writeBytes: async () => {},
      findPersistedPrediction: async () => null,
      requirePaidApis: () => {},
      fingerprintFile: async () => "trackfingerprint",
    })

    expect(uploadReplicateInput).toHaveBeenCalledWith("/tmp/voiceover_track.mp3", "audio/mpeg")
    expect(runJsonModel).toHaveBeenCalledTimes(1)
    const [modelId, payload] = runJsonModel.mock.calls[0]!
    expect(modelId).toBe("victor-upmeet/whisperx")
    // Провайдер получает АДРЕС ЗАЛИВКИ (публичный, скачиваемый), а не
    // локальный путь с диска и не относительный путь хранилища.
    expect(payload).toMatchObject({
      audio_file: "https://api.replicate.com/v1/files/voiceover_track.mp3",
      align_output: true,
    })
    expect(payload).not.toMatchObject({ audio_file: "/tmp/voiceover_track.mp3" })

    // Заливка убирается после использования — не остаётся висеть у провайдера.
    expect(deleteReplicateInput).toHaveBeenCalledWith("file_1")
    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.source).toBe("generated")
  })

  it("ключ идемпотентности строится по ОТПЕЧАТКУ файла, а не по адресу заливки", async () => {
    const uploadReplicateInput = vi.fn(async () => ({
      id: "file_2",
      // Два прогона с одним и тем же локальным файлом дают РАЗНЫЕ временные
      // адреса заливки (Replicate не гарантирует стабильный URL) — если бы
      // identity строилась по URL, повтор считался бы НОВОЙ задачей.
      url: `https://api.replicate.com/v1/files/upload-${Math.random()}`,
    }))
    const runJsonModel = vi.fn(async () => ({ segments: [] }))

    const first = await runMediaTask(baseRequest(), {
      uploadReplicateInput,
      deleteReplicateInput: async () => {},
      runJsonModel,
      writeBytes: async () => {},
      findPersistedPrediction: async () => null,
      requirePaidApis: () => {},
      fingerprintFile: async () => "trackfingerprint",
    })
    const second = await runMediaTask(baseRequest(), {
      uploadReplicateInput,
      deleteReplicateInput: async () => {},
      runJsonModel,
      writeBytes: async () => {},
      findPersistedPrediction: async () => null,
      requirePaidApis: () => {},
      fingerprintFile: async () => "trackfingerprint",
    })

    expect(first.idempotencyKey).toBe(second.idempotencyKey)
    expect(first.idempotencyKey).not.toContain("https://")
  })

  it("повторный прогон того же трека не платит второй раз — найденный prediction возвращается без вызова провайдера", async () => {
    const runJsonModel = vi.fn()
    const uploadReplicateInput = vi.fn(async () => ({
      id: "file_3",
      url: "https://api.replicate.com/v1/files/track.mp3",
    }))

    const result = await runMediaTask(baseRequest(), {
      uploadReplicateInput,
      deleteReplicateInput: async () => {},
      runJsonModel,
      fingerprintFile: async () => "trackfingerprint",
      findPersistedPrediction: async () => ({
        id: "pred_1",
        externalId: null,
        persistedStorageKey: "zavodcamp/videos/44/transcript.json",
      }),
      materializeStorageFile: async () => {},
      readTextFile: async () => JSON.stringify({ segments: [] }),
    })

    // Платный вызов (сама транскрипция) не делается — задача уже оплачена.
    expect(runJsonModel).not.toHaveBeenCalled()
    expect(result.source).toBe("reused_prediction")
    expect(result.costUsd).toBe(0)
  })

  it("заливка не удалась — падает честной ошибкой заливки, платного вызова провайдера не делает", async () => {
    const runJsonModel = vi.fn()
    const uploadReplicateInput = vi.fn(async () => {
      throw new Error("Replicate files: сеть недоступна")
    })

    await expect(runMediaTask(baseRequest(), {
      uploadReplicateInput,
      deleteReplicateInput: async () => {},
      runJsonModel,
      findPersistedPrediction: async () => null,
      requirePaidApis: () => {},
    })).rejects.toThrow(/сеть недоступна/)

    // Ни платного вызова, ни тихого "skipped" — исключение уходит наверх сырым.
    expect(runJsonModel).not.toHaveBeenCalled()
  })
})
