/**
 * Task 6 (2026-08-17-presenter-recordings-and-speech-cut): маршрут «монтаж от
 * звука» режет звук сцены из единого трека, но картинку под него до этой
 * задачи всё ещё подбирал готовый клип с допуском ±1 с — ведущая договаривала
 * в немой кадр либо обрывалась на полуслове. Теперь фрагмент ведущего режется
 * из длинной записи ровно под фактическую длину куска трека (spec §6.2).
 *
 * Два режима: есть завершённая запись-родитель — окно вырезается под кусок
 * трека (`reserveRecordingWindow` + `cutRecordingWindow`); записи нет —
 * прежний подбор ближайшего клипа по длительности (`reservePresenterSourceClip`,
 * не тронут этой задачей вовсе). На старом маршруте (без `audioFirst`) запись
 * не спрашивается — это главный инвариант всей работы.
 *
 * Собрано по образцу lip-sync-duplicate-order-track.spec.ts (audioFirst +
 * fluent-ffmpeg для куска трека) и lip-sync-presenter-slot.spec.ts (набор
 * моков модулей маршрута ведущей). DB-free: prisma, TTS, lip-sync, storage,
 * ffmpeg и резервирование записи замоканы. Ни одного платного вызова.
 */

import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runLipSyncStep } from "../../../server/utils/lip-sync-runner"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const h = vi.hoisted(() => ({
  assetsDir: "",
  step: { id: 606, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  durationByPath: new Map<string, number>(),
  ffmpegRuns: [] as Array<{ input: string; output: string; outputOptions: string[] }>,
  synthesizeSpeech: vi.fn(),
  runLipSync: vi.fn(),
  probeMediaDuration: vi.fn(),
  adjustAudioTempo: vi.fn(),
  reservePresenterSourceClip: vi.fn(),
  reserveRecordingWindow: vi.fn(),
  cutRecordingWindow: vi.fn(),
  uploadLocalAsset: vi.fn(),
}))

// Кусок общего трека под сцену (voiceover/segment-cut.ts) режется через
// fluent-ffmpeg — та же подмена, что в lip-sync-duplicate-order-track.spec.ts.
// Окно записи (presenter/ffmpeg-adapter.ts) через neё НЕ идёт — у него свой
// собственный модуль, замоканный отдельно ниже.
vi.mock("fluent-ffmpeg", () => {
  const ffmpeg = (input: string) => {
    let output = ""
    let outputOptions: string[] = []
    const handlers = new Map<string, (arg?: unknown) => void>()
    const command: Record<string, unknown> = {
      inputOptions: () => command,
      audioFilters: () => command,
      outputOptions: (options: string[]) => { outputOptions = options; return command },
      output: (path: string) => { output = path; return command },
      on: (event: string, cb: (arg?: unknown) => void) => { handlers.set(event, cb); return command },
      run: () => {
        void (async () => {
          const durationIndex = outputOptions.indexOf("-t")
          const durationSec = durationIndex >= 0 ? Number(outputOptions[durationIndex + 1]) : 0
          await writeFile(output, "segment")
          h.durationByPath.set(output, durationSec)
          h.ffmpegRuns.push({ input, output, outputOptions })
          handlers.get("end")?.()
        })()
      },
    }
    return command
  }
  return { default: ffmpeg }
})

vi.mock("../../../server/utils/prisma", () => ({
  prisma: {
    videoAsset: {
      findFirst: async () => null,
      create: async () => ({ id: "new" }),
      update: async () => ({}),
    },
  },
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async () => undefined,
  appendStepLog: async (_id: number, line: string) => { h.logs.push(line) },
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/tts", () => ({ synthesizeSpeech: h.synthesizeSpeech }))
vi.mock("../../../server/utils/media-provider/lip-sync", () => ({ runLipSync: h.runLipSync }))
vi.mock("../../../server/utils/render", () => ({
  probeMediaDuration: h.probeMediaDuration,
  adjustAudioTempo: h.adjustAudioTempo,
}))
vi.mock("../../../server/utils/presenter-source-selector", () => ({
  reservePresenterSourceClip: h.reservePresenterSourceClip,
}))
vi.mock("../../../server/utils/presenter-recording-selector", () => ({
  reserveRecordingWindow: h.reserveRecordingWindow,
}))
vi.mock("../../../server/utils/presenter/ffmpeg-adapter", () => ({
  cutRecordingWindow: h.cutRecordingWindow,
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: async () => undefined }))
vi.mock("../../../server/utils/storage-paths", () => ({ getAssetsDirFor: () => h.assetsDir }))
vi.mock("../../../server/utils/storage", () => ({
  getStorageDriver: () => ({ downloadToFile: async (_k: string, path: string) => { await writeFile(path, "src") } }),
}))
vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: (...args: unknown[]) => h.uploadLocalAsset(...args),
}))
vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: () => "/api/files/lipsync.mp4",
}))
vi.mock("../../../server/utils/video-helpers", () => ({ downloadFile: async () => undefined }))

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-recording-window")
h.assetsDir = ASSETS_DIR

const TRACK_PATH = join(ASSETS_DIR, "voiceover_track.mp3")

const VIDEO_CONFIG = {
  lipSyncEnabled: true,
  lipSyncModelId: null as string | null,
  lipSyncCharacterId: "character-1",
  voiceoverModelId: null as string | null,
  voiceoverVoiceId: null as string | null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as const,
}

/** Ролик целиком ведущей: одна сцена, ячейка clipPaths пустая. */
function presenterOnlyPlan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [{ order: 1, spokenLine: "Реплика ведущей на камеру", durationSec: 5 }],
    totalDurationSec: 0,
  } as unknown as StoryDrivenVideoPlan
}

/** Ролик «монтаж от звука»: одна сцена, границы в треке 0..segmentSec. */
function inputWithAudioFirstSegment(options: { segmentSec: number }) {
  return {
    videoId: 61,
    clipPaths: [""],
    videoPlan: presenterOnlyPlan(),
    clipSceneOrders: [],
    videoConfig: VIDEO_CONFIG,
    audioFirst: {
      trackPath: TRACK_PATH,
      trackDurationSec: 60,
      trackFingerprint: "track-v1",
      fps: 30,
      scenes: [{ order: 1, startSec: 0, endSec: options.segmentSec, words: [] }],
    },
  }
}

/** Прежний посценный маршрут: audioFirst не передан вовсе. */
function inputWithoutAudioFirst() {
  return {
    videoId: 62,
    clipPaths: [""],
    videoPlan: presenterOnlyPlan(),
    clipSceneOrders: [],
    videoConfig: VIDEO_CONFIG,
  }
}

beforeEach(async () => {
  await rm(ASSETS_DIR, { recursive: true, force: true })
  await mkdir(ASSETS_DIR, { recursive: true })
  await writeFile(TRACK_PATH, "track")

  h.step = { id: 606, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.durationByPath.clear()
  h.ffmpegRuns.length = 0

  h.synthesizeSpeech.mockReset()
  h.synthesizeSpeech.mockImplementation(async (args: { outputPath: string }) => {
    await writeFile(args.outputPath, "tts")
    return { costUsd: 0.002 }
  })

  h.runLipSync.mockReset()
  h.runLipSync.mockImplementation(async (req: { outputPath: string }) => {
    await writeFile(req.outputPath, "video")
    return { costUsd: 0.07, provider: "replicate", outputPath: req.outputPath }
  })

  h.probeMediaDuration.mockReset()
  // Кусок трека узнаётся по записанной ffmpeg-фейком длительности; всё
  // прочее (окно записи, TTS-реплика, фолбэк-клип) — безопасная длина
  // внутри диапазона любой lip-sync модели (kling: 2-10с) и совпадающая с
  // куском 6.4с из сценария теста.
  h.probeMediaDuration.mockImplementation(async (path: string) => {
    const known = h.durationByPath.get(path)
    if (known !== undefined) return known
    return 6.4
  })

  h.adjustAudioTempo.mockReset()

  h.reservePresenterSourceClip.mockReset()
  h.reservePresenterSourceClip.mockResolvedValue({
    id: "frag-1",
    name: "frag.mp4",
    fileUrl: "https://storage/frag.mp4",
    storageKey: "presenter/frag.mp4",
    durationSec: 6.4,
  })

  h.reserveRecordingWindow.mockReset()
  h.reserveRecordingWindow.mockResolvedValue(null)

  h.cutRecordingWindow.mockReset()
  h.cutRecordingWindow.mockImplementation(async (args: { outputPath: string }) => {
    await writeFile(args.outputPath, "window")
  })

  h.uploadLocalAsset.mockReset()
  h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => ({
    storageKey, storageProvider: "local", storageBucket: null,
  }))
})

describe("runLipSyncStep: фрагмент ведущего режется из записи под кусок трека", () => {
  it("на audio-first берёт окно записи ровно под длину куска трека", async () => {
    // Кусок трека 6.40 с. Раньше подбирался готовый клип с допуском ±1 с, и
    // ведущая договаривала в немой кадр либо обрывалась. Теперь окно режется
    // под звук.
    h.reserveRecordingWindow.mockResolvedValue({
      recordingId: "rec-1",
      storageKey: "recordings/rec-1.mp4",
      startSec: 12,
      endSec: 18.4,
      durationSec: 6.4,
      overlapSec: 0,
      usageId: "usage-1",
      reused: false,
    })

    await runLipSyncStep(inputWithAudioFirstSegment({ segmentSec: 6.4 }))

    expect(h.reserveRecordingWindow).toHaveBeenCalledWith(
      expect.objectContaining({ requiredSec: 6.4, fps: 30 }),
    )
    expect(h.cutRecordingWindow).toHaveBeenCalledWith(
      expect.objectContaining({ startSec: 12, durationSec: 6.4 }),
    )
    // Подбор готового клипа на этом пути не нужен вовсе.
    expect(h.reservePresenterSourceClip).not.toHaveBeenCalled()
  })

  it("без записи-родителя работает прежний подбор клипа", async () => {
    h.reserveRecordingWindow.mockResolvedValue(null)

    await runLipSyncStep(inputWithAudioFirstSegment({ segmentSec: 6.4 }))

    expect(h.reservePresenterSourceClip).toHaveBeenCalled()
  })

  it("на старом маршруте запись не спрашивается вовсе", async () => {
    // Инвариант всей работы: ролик без editPipeline не должен изменить ни
    // одного вызова.
    await runLipSyncStep(inputWithoutAudioFirst())

    expect(h.reserveRecordingWindow).not.toHaveBeenCalled()
  })
})
