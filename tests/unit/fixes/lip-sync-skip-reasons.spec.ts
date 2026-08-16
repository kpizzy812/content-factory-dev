/**
 * Регрессия на разделение причин отказа lip-sync по природе: материал или среда.
 *
 *   S1 — source_unmeasurable считался детерминированной причиной, то есть закрывал
 *        сцену от повторной попытки навсегда при неизменном исходнике. Но
 *        probeMediaDuration отдаёт null на ЛЮБОЙ неудаче ffprobe, включая
 *        транзиентную (spawn EAGAIN/EMFILE под нагрузкой, свежескачанный mp4,
 *        заблокированный антивирусом на Windows). Один такой прогон навсегда и
 *        молча лишал ролик lip-sync по этой сцене: повторный заход отдавал кэш.
 *
 *        Причина разделена на две. «Файла нет» (source_missing) — свойство
 *        материала: ответ не изменится, сцену закрываем, иначе шаг теряет кэш и
 *        каждый прогон заново гоняет probe и TTS по остальным сценам. «Замер не
 *        удался при существующем файле» (source_unmeasurable) — состояние среды:
 *        кэш не открывает, сцена получает честную вторую попытку.
 *
 * DB-free: prisma/tts/lip-sync/storage замоканы, ffprobe подменён на уровне
 * fluent-ffmpeg (render.ts настоящий), файлы — только в tmpdir.
 */

import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runLipSyncStep } from "../../../server/utils/lip-sync-runner"
import {
  areAllScenesCovered,
  isKnownSkipReason,
  readPreviousSceneRecords,
} from "../../../server/utils/presenter/lip-sync-progress"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

type ProbeCallback = (err: Error | null, metadata?: { format?: { duration?: number } }) => void

const h = vi.hoisted(() => ({
  assetsDir: "",
  stepCompleted: false,
  step: { id: 505, attemptCount: 0, actualCost: null as number | null, outputSnapshot: null as unknown },
  promptSnapshot: null as unknown,
  clipAssets: new Map<number, { id: string; filePath: string }>(),
  /** Что «видит» ffprobe: пути нет в карте — замер не состоялся. */
  durationByPath: new Map<string, number>(),
  ffprobe: vi.fn(),
  assetFindFirst: vi.fn(),
  appendStepLog: vi.fn(),
  updateStep: vi.fn(),
  synthesizeSpeech: vi.fn(),
  runLipSync: vi.fn(),
  uploadLocalAsset: vi.fn(),
  logStepCost: vi.fn(),
}))

vi.mock("fluent-ffmpeg", () => {
  const ffmpeg = Object.assign(
    () => { throw new Error("ffmpeg-пайплайн в юнит-тестах не запускается") },
    { ffprobe: (path: string, cb: ProbeCallback) => h.ffprobe(path, cb) },
  )
  return { default: ffmpeg }
})

vi.mock("../../../server/utils/prisma", () => ({
  prisma: {
    videoAsset: { findFirst: h.assetFindFirst },
    videoGenerationStep: { findFirst: async () => ({ outputSnapshot: h.promptSnapshot }) },
  },
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: h.updateStep,
  appendStepLog: h.appendStepLog,
  isStepCompleted: () => h.stepCompleted,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/tts", () => ({ synthesizeSpeech: h.synthesizeSpeech }))
vi.mock("../../../server/utils/media-provider/lip-sync", () => ({ runLipSync: h.runLipSync }))
vi.mock("../../../server/utils/presenter-source-selector", () => ({
  reservePresenterSourceClip: async () => null,
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: h.logStepCost }))
vi.mock("../../../server/utils/storage-paths", () => ({
  getAssetsDirFor: () => h.assetsDir,
  getVideosBase: () => h.assetsDir,
}))
vi.mock("../../../server/utils/storage", () => ({
  getStorageDriver: () => ({ downloadToFile: async () => undefined }),
}))
vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: (...args: unknown[]) => h.uploadLocalAsset(...args),
}))
vi.mock("../../../server/utils/video-helpers", () => ({ downloadFile: async () => undefined }))

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-skip-reasons")
h.assetsDir = ASSETS_DIR

const clipPath = (index: number) => join(ASSETS_DIR, `scene_${index}_clip.mp4`)
const lipSyncPath = (index: number) => join(ASSETS_DIR, `scene_${index}_lipsync.mp4`)

const VIDEO_CONFIG = {
  lipSyncEnabled: true,
  lipSyncModelId: null as string | null,
  lipSyncCharacterId: null as string | null,
  voiceoverModelId: null as string | null,
  voiceoverVoiceId: null as string | null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as "slow" | "moderate" | "fast",
}

/** Тождественный порядок нарезки: сцена order N лежит в клипе N-1. */
const IDENTITY_PROMPT_SNAPSHOT = {
  scenePrompts: { scenes: [1, 2].map(order => ({ order, prompt: "p" })) },
}

function makePlan(orders: number[]): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: orders.map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 })),
    totalDurationSec: 0,
  } as unknown as StoryDrivenVideoPlan
}

/** Клип есть и на диске, и в ffprobe. */
async function seedClip(index: number, durationSec = 5): Promise<string> {
  await writeFile(clipPath(index), `clip-${index}`)
  h.clipAssets.set(index, { id: `asset-${index}`, filePath: clipPath(index) })
  h.durationByPath.set(clipPath(index), durationSec)
  return clipPath(index)
}

/** Клип числится в списке путей, но файла на диске нет. */
function declareMissingClip(index: number): string {
  h.clipAssets.set(index, { id: `asset-${index}`, filePath: clipPath(index) })
  return clipPath(index)
}

function lastSnapshot(): {
  clipPaths?: string[]
  scenes?: Array<{ sceneIndex: number; outputPath: string | null; skipped?: string | null; reuseKey?: string | null }>
} | null {
  for (let i = h.updateStep.mock.calls.length - 1; i >= 0; i--) {
    const payload = h.updateStep.mock.calls[i]![1] as { outputSnapshot?: unknown }
    if (payload?.outputSnapshot) return payload.outputSnapshot as never
  }
  return null
}

function skipReasonFor(sceneIndex: number): string | null | undefined {
  return lastSnapshot()?.scenes?.find(scene => scene.sceneIndex === sceneIndex)?.skipped
}

/** Стартовал ли шаг заново (то есть ранняя идемпотентность кэш НЕ отдала). */
function stepAttemptGrew(): boolean {
  return h.updateStep.mock.calls.some(call => (call[1] as { status?: string })?.status === "running")
}

function resetCalls(): void {
  h.appendStepLog.mockClear()
  h.updateStep.mockClear()
  h.synthesizeSpeech.mockClear()
  h.runLipSync.mockClear()
  h.uploadLocalAsset.mockClear()
  h.ffprobe.mockClear()
  h.logStepCost.mockClear()
}

beforeEach(async () => {
  await rm(ASSETS_DIR, { recursive: true, force: true })
  await mkdir(ASSETS_DIR, { recursive: true })

  h.stepCompleted = false
  h.step = { id: 505, attemptCount: 0, actualCost: null, outputSnapshot: null }
  h.promptSnapshot = IDENTITY_PROMPT_SNAPSHOT
  h.clipAssets.clear()
  h.durationByPath.clear()

  h.ffprobe.mockReset()
  h.ffprobe.mockImplementation((path: string, cb: ProbeCallback) => {
    const duration = h.durationByPath.get(path)
    if (duration === undefined) {
      // Ровно то, что видит runner при любой беде: ошибка без метаданных.
      cb(new Error("ffprobe: spawn EAGAIN"))
      return
    }
    cb(null, { format: { duration } })
  })

  h.assetFindFirst.mockReset()
  h.assetFindFirst.mockImplementation(async (args: { where: { order: number } }) =>
    h.clipAssets.get(args.where.order) ?? null)
  h.appendStepLog.mockReset()
  h.appendStepLog.mockResolvedValue(undefined)
  h.updateStep.mockReset()
  h.updateStep.mockResolvedValue(undefined)
  h.logStepCost.mockReset()
  h.logStepCost.mockResolvedValue(undefined)

  h.synthesizeSpeech.mockReset()
  h.synthesizeSpeech.mockImplementation(async (args: { outputPath: string }) => {
    await writeFile(args.outputPath, "tts")
    return { costUsd: 0.002 }
  })

  h.runLipSync.mockReset()
  h.runLipSync.mockImplementation(async (req: { outputPath: string }) => {
    await writeFile(req.outputPath, "synced")
    return { costUsd: 0.07, provider: "replicate", outputPath: req.outputPath }
  })

  h.uploadLocalAsset.mockReset()
  h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => ({
    storageKey,
    storageProvider: "local",
    storageBucket: null,
  }))
})

// ─── Чистая часть: какая причина закрывает сцену ─────────────────────────────
describe("lip-sync-progress: природа причины отказа", () => {
  const base = {
    sceneOrder: 2,
    sceneIndex: 1,
    sourcePath: "/a/scene_1_clip.mp4",
    outputPath: null,
    audioPath: null,
    spokenLineHash: null,
    reuseKey: "key-1",
    durationSec: 0,
  }

  const covered = (skipped: string): boolean =>
    areAllScenesCovered([1], readPreviousSceneRecords({ scenes: [{ ...base, skipped }] }))

  it("неудавшийся замер — состояние среды: сцену не закрывает", () => {
    // Раньше здесь было true: один spawn EAGAIN у ffprobe хоронил сцену навсегда.
    expect(covered("source_unmeasurable")).toBe(false)
  })

  it("отсутствующий файл — свойство материала: сцену закрывает", () => {
    // Иначе шаг теряет кэш навсегда и каждый прогон заново мерит и озвучивает остальные сцены.
    expect(covered("source_missing")).toBe(true)
    expect(isKnownSkipReason("source_missing")).toBe(true)
  })

  it("остальные причины остались при своей природе", () => {
    expect(covered("no_clip")).toBe(true)
    expect(covered("clip_index_out_of_range")).toBe(true)
    expect(covered("duration_out_of_range")).toBe(true)
    expect(covered("tts_failed")).toBe(false)
    expect(covered("lip_sync_failed")).toBe(false)
  })

  it("отказы маршрута «монтаж от звука» разделены на материал и среду", () => {
    // Нет границ сцены в выравнивании и нулевой интервал — свойства данных:
    // повторятся один в один, и без покрытия шаг терял бы раннюю идемпотентность
    // навсегда. Появится выравнивание — сменится ключ (в него входит отпечаток
    // куска), и отказ перестанет закрывать сцену сам.
    expect(covered("track_segment_missing")).toBe(true)
    expect(covered("track_segment_empty")).toBe(true)
    expect(isKnownSkipReason("track_segment_missing")).toBe(true)
    expect(isKnownSkipReason("track_segment_empty")).toBe(true)
    // Упавший ffmpeg — состояние минуты: сцена обязана получить вторую попытку.
    expect(covered("track_segment_failed")).toBe(false)
    expect(isKnownSkipReason("track_segment_failed")).toBe(true)
  })
})

// ─── Runner: тот же вопрос на живом шаге ─────────────────────────────────────
describe("runLipSyncStep: неизмеримый источник", () => {
  it("файл на месте, а ffprobe упал — сцена получает вторую попытку", async () => {
    const clipPaths = [await seedClip(0), await seedClip(1)]
    // Файл сцены 2 существует, но замер не состоялся — ровно транзиентный сбой.
    h.durationByPath.delete(clipPath(1))

    await runLipSyncStep({ videoId: 51, clipPaths, videoPlan: makePlan([1, 2]), videoConfig: VIDEO_CONFIG })
    expect(skipReasonFor(1)).toBe("source_unmeasurable")

    const snapshot = lastSnapshot()
    resetCalls()
    h.stepCompleted = true
    h.step = { id: 505, attemptCount: 1, actualCost: 0.072, outputSnapshot: snapshot }
    // Среда оправилась: ffprobe снова отвечает по тому же, ничем не изменившемуся файлу.
    h.durationByPath.set(clipPath(1), 5)

    const result = await runLipSyncStep({
      videoId: 51,
      clipPaths,
      videoPlan: makePlan([1, 2]),
      videoConfig: VIDEO_CONFIG,
    })

    // Раньше шаг молча отдавал кэш и сцена оставалась без lip-sync навсегда.
    expect(stepAttemptGrew()).toBe(true)
    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1)])
    expect(result.resyncedSceneCount).toBe(1)
  })

  it("файла нет на диске — отказ детерминированный, шаг кэшируется", async () => {
    const clipPaths = [await seedClip(0), declareMissingClip(1)]

    const result = await runLipSyncStep({
      videoId: 52,
      clipPaths,
      videoPlan: makePlan([1, 2]),
      videoConfig: VIDEO_CONFIG,
    })
    expect(skipReasonFor(1)).toBe("source_missing")
    expect(result.syncedSceneCount).toBe(1)

    const snapshot = lastSnapshot()
    resetCalls()
    h.stepCompleted = true
    h.step = { id: 505, attemptCount: 1, actualCost: 0.072, outputSnapshot: snapshot }

    await runLipSyncStep({ videoId: 52, clipPaths, videoPlan: makePlan([1, 2]), videoConfig: VIDEO_CONFIG })

    // Файла как не было, так и нет: гонять probe и TTS по остальным сценам незачем.
    expect(stepAttemptGrew()).toBe(false)
    expect(h.ffprobe).not.toHaveBeenCalled()
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.runLipSync).not.toHaveBeenCalled()
  })

  it("появившийся файл снимает отказ: отпечаток исходника сменился", async () => {
    const clipPaths = [await seedClip(0), declareMissingClip(1)]
    await runLipSyncStep({ videoId: 53, clipPaths, videoPlan: makePlan([1, 2]), videoConfig: VIDEO_CONFIG })

    const snapshot = lastSnapshot()
    resetCalls()
    h.stepCompleted = true
    h.step = { id: 505, attemptCount: 1, actualCost: 0.072, outputSnapshot: snapshot }
    // Клип докачался/перегенерировался — сцена обязана получить новую попытку,
    // иначе детерминированный отказ превращается в вечный.
    await seedClip(1)

    const result = await runLipSyncStep({
      videoId: 53,
      clipPaths,
      videoPlan: makePlan([1, 2]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1)])
  })
})
