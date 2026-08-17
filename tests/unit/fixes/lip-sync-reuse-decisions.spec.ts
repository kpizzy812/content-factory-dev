/**
 * Регрессия на решения о переиспользовании lip-sync (четвёртый проход ревью).
 *
 *   R1 — оркестратор решал «доверять ли путям клипов из кэша озвучки» по приросту
 *        attemptCount шага lip-sync. Счётчик растёт и когда шаг ВСЁ поднял из
 *        снапшота (ранняя идемпотентность не сработала — например прогон до этого
 *        оборвался на заливке). Story-driven ролик с voiceoverReconciliation=
 *        extend_scene получал lipSyncRegenerated=true на прогоне, где ни одного
 *        нового файла не появилось, удлинённые озвучкой клипы (*_ext.mp4)
 *        объявлялись «относящимися к прошлым» и в сборку уезжали НЕудлинённые
 *        клипы под озвучку, рассчитанную на удлинённые. Звук уезжал от картинки.
 *        Признак обязан считаться по факту: сколько сцен реально ушло в провайдер.
 *
 *   R2 — ранняя идемпотентность требовала записи в снапшоте для КАЖДОЙ сцены с
 *        репликой, а сцены, которые синхронизировать физически нельзя (длительность
 *        вне диапазона модели, нет клипа), записи не получали. «Покрыты все сцены»
 *        не выполнялось никогда: шаг переставал кэшироваться навсегда и каждый
 *        повторный прогон заново гонял probe и TTS по остальным сценам. Нужна
 *        запись-отказ с причиной, привязанная к тому же отпечатку исходника, что и
 *        успешная — чтобы перегенерация клипа снимала отказ сама собой.
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
  didLipSyncProduceNewClips,
  shouldApplyVoiceoverClipPaths,
} from "../../../server/utils/video-pipeline-run-policy"
import {
  areAllScenesCovered,
  readPreviousSceneRecords,
} from "../../../server/utils/presenter/lip-sync-progress"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

type ProbeCallback = (err: Error | null, metadata?: { format?: { duration?: number } }) => void

const h = vi.hoisted(() => ({
  assetsDir: "",
  stepCompleted: false,
  step: { id: 404, attemptCount: 0, actualCost: null as number | null, outputSnapshot: null as unknown },
  promptSnapshot: null as unknown,
  clipAssets: new Map<number, { id: string; filePath: string }>(),
  /** Что «видит» ffprobe: пути нет в карте — файл битый/отсутствует. */
  durationByPath: new Map<string, number>(),
  ffprobe: vi.fn(),
  /**
   * Пайплайн ffmpeg по умолчанию запрещён (юнит-тест процессов не запускает).
   * Маршрут «монтаж от звука» режет кусок трека — там ставится фейковая команда.
   */
  ffmpegPipeline: null as null | ((input: string) => unknown),
  /** Что фейковый ffmpeg реально «вырезал» — по одной записи на запуск. */
  ffmpegRuns: [] as Array<{ input: string; output: string; outputOptions: string[]; audioFilters: string[] }>,
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
    (input: string) => {
      if (!h.ffmpegPipeline) throw new Error("ffmpeg-пайплайн в юнит-тестах не запускается")
      return h.ffmpegPipeline(input)
    },
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

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-reuse-decisions")
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
  scenePrompts: { scenes: [1, 2, 3].map(order => ({ order, prompt: "p" })) },
}

function makePlan(orders: number[]): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: orders.map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 })),
    totalDurationSec: 0,
  } as unknown as StoryDrivenVideoPlan
}

async function seedClips(count: number, durationSec = 5): Promise<string[]> {
  const paths: string[] = []
  for (let index = 0; index < count; index++) {
    await writeFile(clipPath(index), `clip-${index}`)
    h.clipAssets.set(index, { id: `asset-${index}`, filePath: clipPath(index) })
    h.durationByPath.set(clipPath(index), durationSec)
    paths.push(clipPath(index))
  }
  return paths
}

/** Последний снапшот, записанный шагом — то, что переживёт рестарт воркера. */
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

/** Стартовал ли шаг заново (именно это раньше принимали за «переигран»). */
function stepAttemptGrew(): boolean {
  return h.updateStep.mock.calls.some(call => (call[1] as { status?: string })?.status === "running")
}

/**
 * Фейковый ffmpeg-пайплайн вырезки: файл создаётся, длительность берётся из `-t`
 * (то есть из плана вырезки), процесс не запускается. Заодно это проверка, что
 * длина куска задана именно выходным `-t`.
 */
function fakeSegmentCutter(input: string): unknown {
  const handlers = new Map<string, (arg?: unknown) => void>()
  let output = ""
  let outputOptions: string[] = []
  let audioFilters: string[] = []
  const command: Record<string, unknown> = {
    inputOptions: () => command,
    audioFilters: (filters: string[]) => { audioFilters = filters; return command },
    outputOptions: (options: string[]) => { outputOptions = options; return command },
    output: (path: string) => { output = path; return command },
    on: (event: string, cb: (arg?: unknown) => void) => { handlers.set(event, cb); return command },
    run: () => {
      void (async () => {
        const durationIndex = outputOptions.indexOf("-t")
        const durationSec = durationIndex >= 0 ? Number(outputOptions[durationIndex + 1]) : 0
        await writeFile(output, "segment")
        h.durationByPath.set(output, durationSec)
        h.ffmpegRuns.push({ input, output, outputOptions, audioFilters })
        handlers.get("end")?.()
      })()
    },
  }
  return command
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
  h.step = { id: 404, attemptCount: 0, actualCost: null, outputSnapshot: null }
  h.promptSnapshot = IDENTITY_PROMPT_SNAPSHOT
  h.clipAssets.clear()
  h.durationByPath.clear()
  h.ffmpegPipeline = null
  h.ffmpegRuns.length = 0

  h.ffprobe.mockReset()
  h.ffprobe.mockImplementation((path: string, cb: ProbeCallback) => {
    const duration = h.durationByPath.get(path)
    if (duration === undefined) {
      cb(new Error("ffprobe: No such file or directory"))
      return
    }
    cb(null, duration > 0 ? { format: { duration } } : { format: {} })
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

// ─── R1: признак «lip-sync выдал новые файлы» ────────────────────────────────
describe("runLipSyncStep: счётчик реальных пересинхронизаций", () => {
  it("прогон, где всё поднято из снапшота, не считается пересинхронизацией", async () => {
    const clipPaths = await seedClips(2)

    // Прогон 1 обрывается на заливке последней сцены — ровно отвалившийся storage.
    h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => {
      if (String(storageKey).includes("scene_1_lipsync")) throw new Error("storage недоступен")
      return { storageKey, storageProvider: "local", storageBucket: null }
    })
    await expect(runLipSyncStep({
      videoId: 21,
      clipPaths,
      videoPlan: makePlan([1, 2]),
      videoConfig: VIDEO_CONFIG,
    })).rejects.toThrow("storage недоступен")

    // Прогон 2: шаг НЕ completed (упал), поэтому ранняя идемпотентность не работает
    // и шаг честно стартует заново — но обе сцены поднимаются из снапшота.
    const partial = lastSnapshot()
    resetCalls()
    h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => ({
      storageKey, storageProvider: "local", storageBucket: null,
    }))
    h.step = { id: 404, attemptCount: 1, actualCost: 0.144, outputSnapshot: partial }

    const result = await runLipSyncStep({
      videoId: 21,
      clipPaths,
      videoPlan: makePlan([1, 2]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(result.syncedSceneCount).toBe(2)
    // Счётчик попыток вырос — именно на него смотрел оркестратор.
    expect(stepAttemptGrew()).toBe(true)
    // А новых файлов не появилось, и это единственный честный признак.
    expect(result.resyncedSceneCount).toBe(0)

    // Итог для оркестратора: удлинённые озвучкой клипы из её кэша применить МОЖНО.
    const producedNewClips = didLipSyncProduceNewClips(result, stepAttemptGrew())
    expect(producedNewClips).toBe(false)
    expect(shouldApplyVoiceoverClipPaths({
      voiceoverRegenerated: false,
      lipSyncProducedNewClips: producedNewClips,
    })).toBe(true)
  })

  it("прогон, реально сходивший в провайдер, помечается пересинхронизацией", async () => {
    const clipPaths = await seedClips(2)

    const result = await runLipSyncStep({
      videoId: 21,
      clipPaths,
      videoPlan: makePlan([1, 2]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(result.resyncedSceneCount).toBe(2)
    const producedNewClips = didLipSyncProduceNewClips(result, stepAttemptGrew())
    expect(producedNewClips).toBe(true)
    // Свежие файлы губ ценнее удлинённых клипов прошлого прогона.
    expect(shouldApplyVoiceoverClipPaths({
      voiceoverRegenerated: false,
      lipSyncProducedNewClips: producedNewClips,
    })).toBe(false)
  })

  it("кэш ранней идемпотентности отдаёт нулевой счётчик, а не число прошлого прогона", async () => {
    const clipPaths = await seedClips(1)
    await runLipSyncStep({ videoId: 21, clipPaths, videoPlan: makePlan([1]), videoConfig: VIDEO_CONFIG })

    const snapshot = lastSnapshot()
    resetCalls()
    h.stepCompleted = true
    h.step = { id: 404, attemptCount: 1, actualCost: 0.072, outputSnapshot: snapshot }

    const result = await runLipSyncStep({ videoId: 21, clipPaths, videoPlan: makePlan([1]), videoConfig: VIDEO_CONFIG })

    // В снапшоте лежит resyncedSceneCount=1 от прогона, который платил.
    expect((snapshot as { resyncedSceneCount?: number }).resyncedSceneCount).toBe(1)
    expect(result.resyncedSceneCount).toBe(0)
    expect(didLipSyncProduceNewClips(result, false)).toBe(false)
  })
})

describe("политика доверия клипам озвучки", () => {
  it("факт побеждает счётчик попыток", () => {
    // Прогон, где lip-sync стартовал, но ничего не пересинхронизировал: кэш озвучки
    // (удлинённые клипы) остаётся валидным. Раньше здесь было false и в сборку
    // уезжали НЕудлинённые клипы под озвучку, рассчитанную на удлинённые.
    expect(shouldApplyVoiceoverClipPaths({
      voiceoverRegenerated: false,
      lipSyncProducedNewClips: false,
      lipSyncRegenerated: true,
    })).toBe(true)
  })

  it("без факта остаётся старый фолбэк на прирост попытки", () => {
    expect(shouldApplyVoiceoverClipPaths({ voiceoverRegenerated: false, lipSyncRegenerated: true })).toBe(false)
    expect(shouldApplyVoiceoverClipPaths({ voiceoverRegenerated: false, lipSyncRegenerated: false })).toBe(true)
  })

  it("незавершённый шаг клипов не трогал, что бы ни показывал счётчик", () => {
    expect(didLipSyncProduceNewClips({ status: "skipped", resyncedSceneCount: 0 }, true)).toBe(false)
    expect(didLipSyncProduceNewClips({ status: "disabled" }, true)).toBe(false)
    // Снапшот старого формата: счётчика нет — работает прежний признак.
    expect(didLipSyncProduceNewClips({ status: "completed" }, true)).toBe(true)
    expect(didLipSyncProduceNewClips({ status: "completed" }, false)).toBe(false)
  })
})

// ─── R2: записи-отказы и кэш шага ────────────────────────────────────────────
describe("runLipSyncStep: сцены, которые синхронизировать нельзя", () => {
  /** Сцена 1 в диапазоне модели, сцена 2 — 14 с, для kling это заведомо мимо. */
  async function seedOutOfRangeScene(): Promise<string[]> {
    const clipPaths = await seedClips(2)
    h.durationByPath.set(clipPath(1), 14)
    return clipPaths
  }

  it("отказ по длительности попадает в снапшот с причиной и отпечатком", async () => {
    const clipPaths = await seedOutOfRangeScene()

    const result = await runLipSyncStep({
      videoId: 22,
      clipPaths,
      videoPlan: makePlan([1, 2]),
      videoConfig: VIDEO_CONFIG,
    })

    // Отказ — не синхронизация: счётчики про него не врут.
    expect(result.syncedSceneCount).toBe(1)
    expect(result.clipPaths).toEqual([lipSyncPath(0), clipPath(1)])

    const record = lastSnapshot()?.scenes?.find(scene => scene.sceneIndex === 1)
    expect(record?.skipped).toBe("duration_out_of_range")
    expect(record?.outputPath).toBeNull()
    // Отказ привязан к отпечатку исходника — иначе он заблокировал бы сцену навсегда.
    expect(typeof record?.reuseKey).toBe("string")
  })

  it("повторный прогон отдаёт кэш, а не гоняет шаг заново", async () => {
    const clipPaths = await seedOutOfRangeScene()
    await runLipSyncStep({ videoId: 22, clipPaths, videoPlan: makePlan([1, 2]), videoConfig: VIDEO_CONFIG })

    const snapshot = lastSnapshot()
    resetCalls()
    h.stepCompleted = true
    h.step = { id: 404, attemptCount: 1, actualCost: 0.072, outputSnapshot: snapshot }

    const result = await runLipSyncStep({
      videoId: 22,
      clipPaths,
      videoPlan: makePlan([1, 2]),
      videoConfig: VIDEO_CONFIG,
    })

    // Раньше сцена без записи ломала «покрыты все сцены»: шаг стартовал каждый раз,
    // заново мерил клипы и заново дёргал TTS по остальным сценам.
    expect(stepAttemptGrew()).toBe(false)
    expect(h.ffprobe).not.toHaveBeenCalled()
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(result.clipPaths).toEqual([lipSyncPath(0), clipPath(1)])
    expect(result.resyncedSceneCount).toBe(0)
  })

  it("перегенерация клипа снимает отказ и даёт сцене новую попытку", async () => {
    const clipPaths = await seedOutOfRangeScene()
    await runLipSyncStep({ videoId: 22, clipPaths, videoPlan: makePlan([1, 2]), videoConfig: VIDEO_CONFIG })

    const snapshot = lastSnapshot()
    resetCalls()
    h.stepCompleted = true
    h.step = { id: 404, attemptCount: 1, actualCost: 0.072, outputSnapshot: snapshot }
    // Клип пересняли: путь тот же, содержимое другое, длительность теперь в диапазоне.
    await writeFile(clipPath(1), "clip-1-переснят-и-заметно-короче-по-хронометражу")
    h.durationByPath.set(clipPath(1), 6)

    const result = await runLipSyncStep({
      videoId: 22,
      clipPaths,
      videoPlan: makePlan([1, 2]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1)])
    expect(result.resyncedSceneCount).toBe(1)
  })

  it("сцена без клипа получает отказ и не мешает кэшу", async () => {
    // Клипов два, а реплики есть у трёх сцен: у третьей клипа нет вовсе.
    const clipPaths = await seedClips(2)
    h.promptSnapshot = { scenePrompts: { scenes: [1, 2, 3].map(order => ({ order, prompt: "p" })) } }

    const result = await runLipSyncStep({
      videoId: 23,
      clipPaths,
      videoPlan: makePlan([1, 2, 3]),
      videoConfig: VIDEO_CONFIG,
    })

    const record = lastSnapshot()?.scenes?.find(scene => scene.sceneIndex === 2)
    expect(record?.skipped).toBe("clip_index_out_of_range")
    expect(result.syncedSceneCount).toBe(2)

    const snapshot = lastSnapshot()
    resetCalls()
    h.stepCompleted = true
    h.step = { id: 404, attemptCount: 1, actualCost: 0.144, outputSnapshot: snapshot }

    await runLipSyncStep({ videoId: 23, clipPaths, videoPlan: makePlan([1, 2, 3]), videoConfig: VIDEO_CONFIG })

    expect(stepAttemptGrew()).toBe(false)
    expect(h.runLipSync).not.toHaveBeenCalled()
  })

  it("отказ провайдера кэш не открывает — сцена получает вторую попытку", async () => {
    const clipPaths = await seedClips(2)
    h.synthesizeSpeech.mockImplementation(async (args: { outputPath: string }) => {
      if (String(args.outputPath).includes("scene_1_")) throw new Error("TTS 500")
      await writeFile(args.outputPath, "tts")
      return { costUsd: 0.002 }
    })

    await runLipSyncStep({ videoId: 24, clipPaths, videoPlan: makePlan([1, 2]), videoConfig: VIDEO_CONFIG })
    const record = lastSnapshot()?.scenes?.find(scene => scene.sceneIndex === 1)
    expect(record?.skipped).toBe("tts_failed")

    const snapshot = lastSnapshot()
    resetCalls()
    h.stepCompleted = true
    h.step = { id: 404, attemptCount: 1, actualCost: 0.072, outputSnapshot: snapshot }
    // Провайдер оправился — пятисотка была состоянием минуты, а не материала.
    h.synthesizeSpeech.mockImplementation(async (args: { outputPath: string }) => {
      await writeFile(args.outputPath, "tts")
      return { costUsd: 0.002 }
    })

    const result = await runLipSyncStep({ videoId: 24, clipPaths, videoPlan: makePlan([1, 2]), videoConfig: VIDEO_CONFIG })

    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1)])
  })
})

// ─── Модель записей (чистая часть) ───────────────────────────────────────────
describe("lip-sync-progress: записи-отказы", () => {
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

  it("запись без файла, но с причиной, поднимается из снапшота", () => {
    // Раньше сюда пускали только записи с outputPath — отказ терялся целиком.
    const map = readPreviousSceneRecords({ scenes: [{ ...base, skipped: "duration_out_of_range" }] })
    expect(map.get(1)?.skipped).toBe("duration_out_of_range")
  })

  it("запись без файла и без известной причины остаётся мусором", () => {
    expect(readPreviousSceneRecords({ scenes: [{ ...base, skipped: "потому что" }] }).size).toBe(0)
    expect(readPreviousSceneRecords({ scenes: [base] }).size).toBe(0)
  })

  it("детерминированный отказ закрывает сцену, отказ провайдера — нет", () => {
    const deterministic = readPreviousSceneRecords({ scenes: [{ ...base, skipped: "no_clip" }] })
    const transient = readPreviousSceneRecords({ scenes: [{ ...base, skipped: "lip_sync_failed" }] })
    expect(areAllScenesCovered([1], deterministic)).toBe(true)
    expect(areAllScenesCovered([1], transient)).toBe(false)
  })

  it("сцена без клипа в порядке нарезки записи не требует", () => {
    const records = readPreviousSceneRecords({ scenes: [{ ...base, skipped: "no_clip" }] })
    // undefined — сцена, которой не нашлось клипа: её состояние пересчитывается
    // каждый прогон, хранить его негде (ключ записи — индекс клипа).
    expect(areAllScenesCovered([1, undefined], records)).toBe(true)
    expect(areAllScenesCovered([undefined], records)).toBe(false)
  })
})

// ─── Маршрут «монтаж от звука»: решения о переиспользовании куска трека ──────
describe("runLipSyncStep: звук сцены из общего трека", () => {
  const TRACK_PATH = join(ASSETS_DIR, "voiceover_track.mp3")

  /**
   * Границы сцены в треке. `jitterSec` — дрожание выравнивания ВНУТРИ одного
   * кадра (30 fps): кусок от него не меняется ни на байт.
   */
  function audioFirstInput(options: { jitterSec?: number; fingerprint?: string } = {}) {
    const jitter = options.jitterSec ?? 0
    return {
      trackPath: TRACK_PATH,
      trackDurationSec: 60,
      trackFingerprint: options.fingerprint ?? "track-v1",
      fps: 30,
      scenes: [{ order: 1, startSec: 1.2333 + jitter, endSec: 4.6 + jitter, words: [] }],
    }
  }

  async function seedTrack(): Promise<string[]> {
    const clipPaths = await seedClips(1)
    await writeFile(TRACK_PATH, "track")
    h.durationByPath.set(TRACK_PATH, 60)
    h.ffmpegPipeline = fakeSegmentCutter
    return clipPaths
  }

  it("режет кусок трека вместо синтеза и отдаёт его модели", async () => {
    const clipPaths = await seedTrack()

    await runLipSyncStep({
      videoId: 25,
      clipPaths,
      videoPlan: makePlan([1]),
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput(),
    })

    // Ни одного платного синтеза: трек уже оплачен шагом озвучки.
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.ffmpegRuns).toHaveLength(1)
    expect(h.ffmpegRuns[0]!.input).toBe(TRACK_PATH)
    // В модель уходит именно вырезанный кусок, а не посценный mp3. ffmpeg при
    // этом пишет во временный файл РЯДОМ с audioPath (temp+rename, Task 3
    // atomic-write): суффикс встаёт ПЕРЕД расширением (buildTempSegmentPath),
    // иначе настоящий ffmpeg отказывается писать файл без расширения на конце
    // (ревью Task 3, Critical) — сравнивать напрямую с h.ffmpegRuns[0].output
    // нельзя, это ещё не переименованный temp.
    const request = h.runLipSync.mock.calls[0]![0] as { audioPath: string }
    const audioBase = request.audioPath.replace(/\.mp3$/, "")
    expect(h.ffmpegRuns[0]!.output.startsWith(`${audioBase}.tmp-`)).toBe(true)
    expect(h.ffmpegRuns[0]!.output.endsWith(".mp3")).toBe(true)
    expect(request.audioPath).toContain("_track_")
  })

  it("дрожание границ внутри кадра при том же треке не отменяет переиспользование", async () => {
    const clipPaths = await seedTrack()
    await runLipSyncStep({
      videoId: 25,
      clipPaths,
      videoPlan: makePlan([1]),
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput(),
    })

    const snapshot = lastSnapshot()
    resetCalls()
    h.ffmpegRuns.length = 0
    h.stepCompleted = true
    h.step = { id: 404, attemptCount: 1, actualCost: 0.072, outputSnapshot: snapshot }

    // Выравнивание пересчитали: границы уехали на доли миллисекунды, кадр тот же.
    // Без притяжки к кадру ключ сцены менялся бы и ролик переоплачивал бы lip-sync.
    const result = await runLipSyncStep({
      videoId: 25,
      clipPaths,
      videoPlan: makePlan([1]),
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput({ jitterSec: 0.0004 }),
    })

    expect(stepAttemptGrew()).toBe(false)
    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(h.ffmpegRuns).toHaveLength(0)
    expect(result.resyncedSceneCount).toBe(0)
    expect(result.clipPaths).toEqual([lipSyncPath(0)])
  })

  it("новый трек обесценивает готовую сцену — иначе к свежему звуку встанут старые губы", async () => {
    const clipPaths = await seedTrack()
    await runLipSyncStep({
      videoId: 25,
      clipPaths,
      videoPlan: makePlan([1]),
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput(),
    })

    const snapshot = lastSnapshot()
    resetCalls()
    h.ffmpegRuns.length = 0
    h.stepCompleted = true
    h.step = { id: 404, attemptCount: 1, actualCost: 0.072, outputSnapshot: snapshot }

    // Трек переозвучили: текст сцены тот же, звук другой.
    const result = await runLipSyncStep({
      videoId: 25,
      clipPaths,
      videoPlan: makePlan([1]),
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput({ fingerprint: "track-v2" }),
    })

    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(h.ffmpegRuns).toHaveLength(1)
    expect(result.resyncedSceneCount).toBe(1)
  })

  it("отказ «нет выравнивания» не принимается прогоном посценного маршрута за свой", async () => {
    const clipPaths = await seedTrack()

    // Сцена 1 есть в плане, но в выравнивании её нет — вырезать нечего.
    await runLipSyncStep({
      videoId: 26,
      clipPaths,
      videoPlan: makePlan([1]),
      videoConfig: VIDEO_CONFIG,
      audioFirst: { ...audioFirstInput(), scenes: [] },
    })

    const record = lastSnapshot()?.scenes?.find(scene => scene.sceneIndex === 0)
    expect(record?.skipped).toBe("track_segment_missing")
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()

    const snapshot = lastSnapshot()
    resetCalls()
    h.ffmpegRuns.length = 0
    h.stepCompleted = true
    h.step = { id: 404, attemptCount: 1, actualCost: 0, outputSnapshot: snapshot }

    // Прогон БЕЗ audioFirst (флаг выключили, транскрипция не доехала): отказ
    // маршрута трека к нему не относится, сцену обязаны синхронизировать честно.
    const result = await runLipSyncStep({
      videoId: 26,
      clipPaths,
      videoPlan: makePlan([1]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.synthesizeSpeech).toHaveBeenCalledTimes(1)
    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(result.clipPaths).toEqual([lipSyncPath(0)])
  })
})
