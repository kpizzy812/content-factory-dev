/**
 * Регрессии третьего прохода по шагу lip_sync_generation.
 *
 *   A — допуск на границах диапазона модели. Строгий замер (probeMediaDuration)
 *       сравнивался с границами модели без допуска: Kling отдаёт клип «на 10 с»,
 *       а в контейнере format.duration = 10.03-10.2 с, и сцена, склампленная ровно
 *       к верхней границе (самый частый случай в проде), выпадала из диапазона по
 *       сотым и молча теряла lip-sync навсегда.
 *   B — признак «файл уже синхронизирован» ловил только `_lipsync.mp4`, тогда как
 *       политика extend_scene делает из него `_lipsync_ext.mp4` и кладёт в
 *       VideoAsset(type=clip).filePath. На следующем прогоне такой файл брался
 *       ИСТОЧНИКОМ и синхронизация ложилась поверх синхронизации.
 *   C — подстановка результата по индексу сцены расширяла clipPaths дырами
 *       (undefined), если индекс из снапшота prompt_generation выходил за длину
 *       списка клипов из clip_generation. Дыры уезжали в сборку.
 *
 * Всё DB-free: prisma/tts/lip-sync/storage замоканы, файлы — только в tmpdir.
 */

import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clampDurationToModelRange,
  findEmptyClipPathIndexes,
  isAssignableClipIndex,
  isDurationWithinModelRange,
  isLipSyncOutputPath,
  resolveSceneSourcePath,
  MODEL_DURATION_TOLERANCE_SEC,
} from "../../../server/utils/presenter/scene-clip-mapping"
import { runLipSyncStep } from "../../../server/utils/lip-sync-runner"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

interface LipSyncCallArgs {
  sourceVideoPath: string
  outputPath: string
  audioPath: string
  sceneOrder: number
  durationSec: number
}

const h = vi.hoisted(() => ({
  assetsDir: "",
  step: { id: 303, attemptCount: 0, outputSnapshot: null as unknown },
  /** Таблица VideoAsset(type=clip): ключ — order в БД. */
  clipAssets: new Map<number, { id: string; filePath: string }>(),
  /** Реальные длительности файлов (вместо ffprobe). */
  durationByPath: new Map<string, number>(),
  assetFindFirst: vi.fn(),
  assetUpdate: vi.fn(),
  appendStepLog: vi.fn(),
  updateStep: vi.fn(),
  synthesizeSpeech: vi.fn(),
  runLipSync: vi.fn(),
  probeMediaDuration: vi.fn(),
  reservePresenterSourceClip: vi.fn(),
  logStepCost: vi.fn(),
}))

vi.mock("../../../server/utils/prisma", () => ({
  prisma: {
    videoAsset: { findFirst: h.assetFindFirst, update: h.assetUpdate },
    // Снапшот prompt_generation здесь не нужен: порядок нарезки тесты передают
    // явным clipSceneOrders.
    videoGenerationStep: { findFirst: async () => null },
  },
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: h.updateStep,
  appendStepLog: h.appendStepLog,
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/tts", () => ({ synthesizeSpeech: h.synthesizeSpeech }))
vi.mock("../../../server/utils/media-provider/lip-sync", () => ({ runLipSync: h.runLipSync }))
vi.mock("../../../server/utils/render", () => ({ probeMediaDuration: h.probeMediaDuration }))
vi.mock("../../../server/utils/presenter-source-selector", () => ({
  reservePresenterSourceClip: h.reservePresenterSourceClip,
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: h.logStepCost }))
vi.mock("../../../server/utils/storage-paths", () => ({ getAssetsDirFor: () => h.assetsDir }))
vi.mock("../../../server/utils/storage", () => ({
  getStorageDriver: () => ({ downloadToFile: async () => undefined }),
}))
vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: async (_path: string, storageKey: string) => ({
    storageKey,
    storageProvider: "local",
    storageBucket: null,
  }),
}))
vi.mock("../../../server/utils/video-helpers", () => ({ downloadFile: async () => undefined }))

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-duration-tolerance")
h.assetsDir = ASSETS_DIR

const clipPath = (index: number) => join(ASSETS_DIR, `scene_${index}_clip.mp4`)
const lipSyncPath = (index: number) => join(ASSETS_DIR, `scene_${index}_lipsync.mp4`)
/** Что оставляет после себя политика extend_scene поверх lip-sync результата. */
const lipSyncExtPath = (index: number) => join(ASSETS_DIR, `scene_${index}_lipsync_ext.mp4`)

const VIDEO_CONFIG = {
  lipSyncEnabled: true,
  lipSyncModelId: null,
  lipSyncCharacterId: null,
  voiceoverModelId: null,
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as const,
}

/** Минимальный storyPlan: важны только order, spokenLine и durationSec. */
function makePlan(scenes: Array<{ order: number; spokenLine: string | null; durationSec: number }>): StoryDrivenVideoPlan {
  return { mode: "story_driven", scenes, totalDurationSec: 0 } as unknown as StoryDrivenVideoPlan
}

function lipSyncCalls(): LipSyncCallArgs[] {
  return h.runLipSync.mock.calls.map(call => call[0] as LipSyncCallArgs)
}

beforeEach(async () => {
  await rm(ASSETS_DIR, { recursive: true, force: true })
  await mkdir(ASSETS_DIR, { recursive: true })

  h.step = { id: 303, attemptCount: 0, outputSnapshot: null }
  h.clipAssets.clear()
  h.durationByPath.clear()

  h.assetFindFirst.mockReset()
  h.assetFindFirst.mockImplementation(async (args: { where: { order: number } }) =>
    h.clipAssets.get(args.where.order) ?? null)
  h.assetUpdate.mockReset()
  h.assetUpdate.mockResolvedValue({})
  h.appendStepLog.mockReset()
  h.appendStepLog.mockResolvedValue(undefined)
  h.updateStep.mockReset()
  h.updateStep.mockResolvedValue(undefined)
  h.logStepCost.mockReset()
  h.logStepCost.mockResolvedValue(undefined)

  h.synthesizeSpeech.mockReset()
  h.synthesizeSpeech.mockResolvedValue({ costUsd: 0.002 })

  h.runLipSync.mockReset()
  h.runLipSync.mockImplementation(async (req: LipSyncCallArgs) => ({
    costUsd: 0.07,
    provider: "replicate",
    outputPath: req.outputPath,
  }))

  h.probeMediaDuration.mockReset()
  h.probeMediaDuration.mockImplementation(async (path: string) => h.durationByPath.get(path) ?? 5)

  h.reservePresenterSourceClip.mockReset()
  h.reservePresenterSourceClip.mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// A. Допуск на границах диапазона модели
// ---------------------------------------------------------------------------

describe("A: допуск на границах диапазона модели", () => {
  it("контейнерная погрешность на верхней границе не выбрасывает сцену", () => {
    // Ровно тот случай: номинал 10 с, format.duration 10.03-10.2 с.
    expect(isDurationWithinModelRange(10.03, 2, 10)).toBe(true)
    expect(isDurationWithinModelRange(10.2, 2, 10)).toBe(true)
    expect(isDurationWithinModelRange(10 + MODEL_DURATION_TOLERANCE_SEC, 2, 10)).toBe(true)
    // И на нижней границе тоже.
    expect(isDurationWithinModelRange(1.9, 2, 10)).toBe(true)
  })

  it("реально чужая длительность по-прежнему вне диапазона", () => {
    expect(isDurationWithinModelRange(10.3, 2, 10)).toBe(false)
    expect(isDurationWithinModelRange(25, 2, 10)).toBe(false)
    expect(isDurationWithinModelRange(1.5, 2, 10)).toBe(false)
    expect(isDurationWithinModelRange(Number.NaN, 2, 10)).toBe(false)
  })

  it("длительность для провайдера зажимается в объявленный диапазон", () => {
    expect(clampDurationToModelRange(10.03, 2, 10)).toBe(10)
    expect(clampDurationToModelRange(1.85, 2, 10)).toBe(2)
    expect(clampDurationToModelRange(7.5, 2, 10)).toBe(7.5)
    // Бессмысленные границы значение не портят.
    expect(clampDurationToModelRange(7.5, 10, 2)).toBe(7.5)
    expect(Number.isNaN(clampDurationToModelRange(Number.NaN, 2, 10))).toBe(true)
  })

  it("сцена с клипом 10.03с синхронизируется, а в модель уходит зажатые 10с", async () => {
    const clipPaths = [clipPath(0)]
    h.clipAssets.set(0, { id: "asset-0", filePath: clipPath(0) })
    // Kling отдал «10 секунд», ffprobe видит 10.03.
    h.durationByPath.set(clipPath(0), 10.03)

    const result = await runLipSyncStep({
      videoId: 11,
      clipPaths,
      clipSceneOrders: [1],
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика один", durationSec: 10 }]),
      videoConfig: VIDEO_CONFIG,
    })

    const calls = lipSyncCalls()
    // Без допуска сцена молча пропускалась и lip-sync терялся навсегда.
    expect(calls).toHaveLength(1)
    // Провайдер валидирует durationSec строго — «как измерено» уронило бы вызов.
    expect(calls[0]!.durationSec).toBeCloseTo(10, 5)
    expect(calls[0]!.durationSec).toBeLessThanOrEqual(10)
    expect(result.clipPaths).toEqual([lipSyncPath(0)])
    expect(result.syncedSceneCount).toBe(1)
  })

  it("источник, реально вне диапазона, всё так же пропускается", async () => {
    const clipPaths = [clipPath(0)]
    h.clipAssets.set(0, { id: "asset-0", filePath: clipPath(0) })
    // 25 с при максимуме 10 — это не погрешность контейнера.
    h.durationByPath.set(clipPath(0), 25)

    const result = await runLipSyncStep({
      videoId: 11,
      clipPaths,
      clipSceneOrders: [1],
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика один", durationSec: 25 }]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(result.clipPaths).toEqual([clipPath(0)])
    expect(result.syncedSceneCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// B. Производные lip-sync файлы (extend_scene)
// ---------------------------------------------------------------------------

describe("B: производный lip-sync файл не берётся источником", () => {
  it("признак ловит и _lipsync.mp4, и производные extend_scene", () => {
    expect(isLipSyncOutputPath("/data/1/scene_0_lipsync.mp4")).toBe(true)
    expect(isLipSyncOutputPath("/data/1/scene_0_lipsync_ext.mp4")).toBe(true)
    expect(isLipSyncOutputPath("/data/1/scene_0_LIPSYNC_EXT.MP4")).toBe(true)
    expect(isLipSyncOutputPath("/data/1/scene_0_lipsync_ext_ext.mp4")).toBe(true)
    // Обычные клипы признаком не задеваются.
    expect(isLipSyncOutputPath("/data/1/scene_0_clip.mp4")).toBe(false)
    expect(isLipSyncOutputPath("/data/1/scene_0_clip_ext.mp4")).toBe(false)
    expect(isLipSyncOutputPath(null)).toBe(false)
  })

  it("исходник берётся из снапшота, если и clipPaths, и ассет указывают на _lipsync_ext", () => {
    const resolved = resolveSceneSourcePath({
      sceneIndex: 0,
      clipPaths: [lipSyncExtPath(0)],
      assetFilePath: lipSyncExtPath(0),
      snapshotSourcePath: clipPath(0),
    })

    expect(resolved.path).toBe(clipPath(0))
    expect(resolved.origin).toBe("snapshot")
  })

  it("сцена пропускается, если единственный кандидат — удлинённый lip-sync файл", async () => {
    // Состояние после прогона с voiceoverReconciliation='extend_scene': и в
    // clipPaths, и в VideoAsset лежит scene_0_lipsync_ext.mp4.
    const clipPaths = [lipSyncExtPath(0)]
    h.clipAssets.set(0, { id: "asset-0", filePath: lipSyncExtPath(0) })

    const result = await runLipSyncStep({
      videoId: 11,
      clipPaths,
      clipSceneOrders: [1],
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика один", durationSec: 8 }]),
      videoConfig: VIDEO_CONFIG,
    })

    // Иначе синхронизация легла бы поверх синхронизации, причём за деньги.
    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(result.clipPaths).toEqual([lipSyncExtPath(0)])
    expect(result.syncedSceneCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// C. Индекс сцены за пределами списка клипов
// ---------------------------------------------------------------------------

describe("C: индекс сцены за пределами списка клипов", () => {
  it("проверка границ индекса", () => {
    expect(isAssignableClipIndex(0, 2)).toBe(true)
    expect(isAssignableClipIndex(1, 2)).toBe(true)
    expect(isAssignableClipIndex(2, 2)).toBe(false)
    expect(isAssignableClipIndex(-1, 2)).toBe(false)
    expect(isAssignableClipIndex(1.5, 2)).toBe(false)
    expect(isAssignableClipIndex(0, 0)).toBe(false)
  })

  it("пустые элементы списка клипов находятся", () => {
    expect(findEmptyClipPathIndexes(["a", undefined, "b", "  "])).toEqual([1, 3])
    expect(findEmptyClipPathIndexes(["a", "b"])).toEqual([])
  })

  it("сцена с индексом за длиной clipPaths пропускается, дыр в результате нет", async () => {
    // Рассинхрон снапшотов: prompt_generation знает 4 клипа, clip_generation отдал 2.
    const clipPaths = [clipPath(0), clipPath(1)]
    h.clipAssets.set(0, { id: "asset-0", filePath: clipPath(0) })
    h.clipAssets.set(1, { id: "asset-1", filePath: clipPath(1) })
    // Ассет для «лишнего» индекса есть — старый код брал его источником и платил.
    h.clipAssets.set(3, { id: "asset-3", filePath: clipPath(3) })

    const result = await runLipSyncStep({
      videoId: 11,
      clipPaths,
      // order=3 попадает на индекс 3, которого в clipPaths нет.
      clipSceneOrders: [1, 2, 7, 3],
      videoPlan: makePlan([
        { order: 1, spokenLine: "Реплика один", durationSec: 5 },
        { order: 2, spokenLine: "Реплика два", durationSec: 5 },
        { order: 3, spokenLine: "Реплика три", durationSec: 5 },
      ]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(lipSyncCalls().map(call => call.sceneOrder)).toEqual([1, 2])
    // Раньше присваивание по индексу 3 растягивало массив до 4 элементов,
    // и на позиции 2 оставалась дыра undefined, уезжавшая в сборку.
    expect(result.clipPaths).toHaveLength(clipPaths.length)
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1)])
    expect(findEmptyClipPathIndexes(result.clipPaths)).toEqual([])
  })
})
