/**
 * Шаги маршрута audio-first: единый трек и транскрипция.
 *
 * Проверяется то, за что платят деньги и чем режется звук:
 *  - отпечаток трека считается по ФИНАЛЬНОМУ файлу (после вставки пауз) — по
 *    нему lip-sync строит ключи кусков, и отпечаток «до пауз» означал бы ключи
 *    от одного файла при звуке из другого;
 *  - повторный прогон не синтезирует трек заново ни при живом файле, ни после
 *    рестарта, когда файл остался только в хранилище (у TTS нет seed: новый
 *    трек звучит иначе и обесценивает уже снятые аватарные кадры);
 *  - отказ транскрипции ролик не роняет, а её результат кэшируется по
 *    отпечатку трека.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const h = vi.hoisted(() => ({
  step: { id: 7, attemptCount: 0, actualCost: 0, status: "pending", outputSnapshot: null as unknown },
  stepCompleted: false,
  updates: [] as Array<Record<string, unknown>>,
  uploads: [] as string[],
  downloads: [] as string[],
  logs: [] as string[],
  /** Файл, который «скачивается» из хранилища, и его содержимое. */
  downloadWrites: null as null | (() => Promise<void>),
  transcriptionTask: vi.fn(async () => ({ costUsd: 0.02, raw: { words: [] } })),
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  STEP_ORDER: [
    "prompt_generation", "image_generation", "clip_generation",
    "voiceover_generation", "music_generation", "lip_sync_generation", "assembly",
    "transcription",
  ],
  ensureStep: async () => h.step,
  updateStep: async (_id: number, data: Record<string, unknown>) => { h.updates.push(data) },
  appendStepLog: async (_id: number, message: string) => { h.logs.push(message) },
  isStepCompleted: () => h.stepCompleted,
  updateVideoStatus: async () => {},
}))

vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: async (localPath: string, storageKey: string) => {
    h.uploads.push(localPath)
    return {
      storageKey,
      storageProvider: "local",
      fileSizeBytes: 1n,
      // Отпечаток считается ХРАНИЛИЩЕМ по тому файлу, который ему отдали:
      // так в тесте видно, какой именно файл попал в ключи lip-sync.
      fileSha256: `sha:${localPath}`,
      contentType: "audio/mpeg",
    }
  },
}))

vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: (key: string) => `/api/files/${key}`,
}))

vi.mock("../../../server/utils/storage", () => ({
  getStorageDriver: () => ({
    providerName: "local",
    downloadToFile: async (key: string, localPath: string) => {
      h.downloads.push(key)
      if (!h.downloadWrites) throw new Error("нет объекта в хранилище")
      await h.downloadWrites()
      return localPath
    },
    getSignedDownloadUrl: async (key: string) => `https://cdn/${key}`,
  }),
}))

vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: async () => {} }))
vi.mock("../../../server/utils/transcription/media-task", () => ({
  requestTranscription: h.transcriptionTask,
}))

let assetsDir = ""

function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.logAgent = async () => {}
  g.getAssetsDir = () => assetsDir
  g.ensureDir = async () => {}
  g.prisma = {
    videoAsset: { findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
    character: { findUnique: async () => ({ name: "Ведущая" }) },
  }
}

async function loadSteps() {
  installGlobals()
  return import("../../../server/utils/video-pipeline-steps")
}

const PLAN = {
  mode: "story_driven",
  scenes: [
    { order: 1, durationSec: 6, spokenLine: "Первая реплика. [пауза 2с]" },
    { order: 2, durationSec: 8, spokenLine: "Вторая реплика." },
  ],
  voiceoverPlan: { enabled: false, lines: [] },
} as never

const CONFIG = {
  voiceoverEnabled: false,
  voiceoverModelId: "minimax/speech-02-turbo",
  voiceoverVoiceId: "clone-1",
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as const,
  lipSyncCharacterId: "character-1",
}

beforeEach(async () => {
  assetsDir = await mkdtemp(join(tmpdir(), "cf-audio-first-"))
  h.step = { id: 7, attemptCount: 0, actualCost: 0, status: "pending", outputSnapshot: null }
  h.stepCompleted = false
  h.updates.length = 0
  h.uploads.length = 0
  h.downloads.length = 0
  h.logs.length = 0
  h.downloadWrites = null
  h.transcriptionTask.mockClear()
})

describe("шаг единого трека", () => {
  it("отпечаток считается по файлу ПОСЛЕ вставки пауз", async () => {
    const { runAudioFirstVoiceover } = await loadSteps()
    const rawPath = join(assetsDir, "voiceover_track.mp3")
    const pausedPath = join(assetsDir, "voiceover_track_pauses.mp3")

    const result = await runAudioFirstVoiceover(44, CONFIG, PLAN, {
      synthesize: async () => ({ audioPath: rawPath, durationSec: 12.1, costUsd: 0.07 }),
      insertPauses: async () => ({ path: pausedPath, durationSec: 14.05, skippedPauses: [] }),
    })

    expect(h.uploads).toEqual([pausedPath])
    expect(result.trackFingerprint).toBe(`sha:${pausedPath}`)
    expect(result.trackPath).toBe(pausedPath)
    // Длительность — измеренная на готовом файле, а не «синтез плюс пауза».
    expect(result.durationSec).toBeCloseTo(14.05, 3)
  })

  it("сцены отдаются с очищенным от маркеров текстом — именно они идут в выравнивание", async () => {
    const { runAudioFirstVoiceover } = await loadSteps()

    const result = await runAudioFirstVoiceover(44, CONFIG, PLAN, {
      synthesize: async () => ({ audioPath: join(assetsDir, "t.mp3"), durationSec: 12, costUsd: 0.07 }),
      insertPauses: async (path: string) => ({ path, durationSec: 14, skippedPauses: [] }),
    })

    expect(result.scenes).toEqual([
      { order: 1, text: "Первая реплика." },
      { order: 2, text: "Вторая реплика." },
    ])
  })

  it("второй прогон не платит за уже синтезированный трек", async () => {
    const trackPath = join(assetsDir, "voiceover_track.mp3")
    await writeFile(trackPath, "audio")
    h.stepCompleted = true
    h.step.outputSnapshot = {
      route: "audio_first",
      trackPath,
      durationSec: 14.05,
      trackFingerprint: "sha-старого-трека",
      storageKey: "zavodcamp/videos/44/voiceover_mix.mp3",
      scenes: [{ order: 1, text: "Первая реплика." }],
      totalCostUsd: 0.07,
      modelId: "minimax/speech-02-turbo",
      voiceId: "clone-1",
    }
    const { runAudioFirstVoiceover } = await loadSteps()
    const synthesize = vi.fn()

    const result = await runAudioFirstVoiceover(44, CONFIG, PLAN, { synthesize: synthesize as never })

    expect(synthesize).not.toHaveBeenCalled()
    expect(result.status).toBe("completed")
    expect(result.trackFingerprint).toBe("sha-старого-трека")
    expect(result.totalCostUsd).toBe(0)
  })

  it("после рестарта трек тянется из хранилища, а не синтезируется заново", async () => {
    const trackPath = join(assetsDir, "voiceover_track.mp3")
    h.downloadWrites = async () => { await writeFile(trackPath, "audio") }
    h.stepCompleted = true
    h.step.outputSnapshot = {
      route: "audio_first",
      trackPath,
      durationSec: 14.05,
      trackFingerprint: "sha-старого-трека",
      storageKey: "zavodcamp/videos/44/voiceover_mix.mp3",
      scenes: [],
      totalCostUsd: 0.07,
      modelId: null,
      voiceId: "clone-1",
    }
    const { runAudioFirstVoiceover } = await loadSteps()
    const synthesize = vi.fn()

    const result = await runAudioFirstVoiceover(44, CONFIG, PLAN, { synthesize: synthesize as never })

    expect(h.downloads).toEqual(["zavodcamp/videos/44/voiceover_mix.mp3"])
    expect(synthesize).not.toHaveBeenCalled()
    expect(result.totalCostUsd).toBe(0)
  })

  it("без голоса синтеза не происходит вовсе — чужой голос на лицо ведущего недопустим", async () => {
    const { runAudioFirstVoiceover } = await loadSteps()
    const synthesize = vi.fn()

    await expect(runAudioFirstVoiceover(
      44,
      { ...CONFIG, voiceoverVoiceId: null },
      PLAN,
      { synthesize: synthesize as never },
    )).rejects.toThrow(/голос/i)

    expect(synthesize).not.toHaveBeenCalled()
    expect(h.updates.some(update => update.status === "failed")).toBe(true)
  })
})

describe("шаг транскрипции", () => {
  const TRACK = {
    path: "/tmp/voiceover_track.mp3",
    fingerprint: "sha-трека",
    storageKey: "zavodcamp/videos/44/voiceover_mix.mp3",
  }
  const SCENES = [{ order: 1, text: "Первая реплика." }]

  it("отказ провайдера ролик не роняет — сцены пустые, шаг пропущен", async () => {
    h.transcriptionTask.mockImplementationOnce(async () => { throw new Error("provider is down") })
    const { runVideoTranscription } = await loadSteps()

    const result = await runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })

    expect(result.status).toBe("skipped")
    expect(result.scenes).toEqual([])
    expect(h.updates.at(-1)).toMatchObject({ status: "skipped" })
  })

  it("готовый транскрипт того же трека не оплачивается второй раз", async () => {
    h.stepCompleted = true
    h.step.outputSnapshot = {
      trackFingerprint: "sha-трека",
      status: "completed",
      scenes: [{ order: 1, startSec: 0, endSec: 3.2, words: [] }],
      warning: null,
    }
    const { runVideoTranscription } = await loadSteps()

    const result = await runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })

    expect(h.transcriptionTask).not.toHaveBeenCalled()
    expect(result.scenes).toHaveLength(1)
    expect(result.costUsd).toBe(0)
  })

  it("перезаписанный трек обесценивает транскрипт — границы относились к другому звуку", async () => {
    h.stepCompleted = true
    h.step.outputSnapshot = {
      trackFingerprint: "sha-ПРОШЛОГО-трека",
      status: "completed",
      scenes: [{ order: 1, startSec: 0, endSec: 3.2, words: [] }],
      warning: null,
    }
    const { runVideoTranscription } = await loadSteps()

    await runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })

    expect(h.transcriptionTask).toHaveBeenCalledTimes(1)
  })

  it("без ключа в хранилище платного вызова не делает", async () => {
    const { runVideoTranscription } = await loadSteps()

    const result = await runVideoTranscription({
      videoId: 44,
      track: { ...TRACK, storageKey: null },
      scenes: SCENES,
      language: "ru",
    })

    expect(h.transcriptionTask).not.toHaveBeenCalled()
    expect(result.status).toBe("skipped")
  })
})
