/**
 * Регрессия на шаг lip_sync_generation целиком (runLipSyncStep), а не на его
 * чистые кусочки. Чистая часть покрыта в lip-sync-scene-mapping.spec.ts, но она
 * НЕ доказывает, что runner ей пользуется — эти тесты падают на старом runner'е.
 *
 * Дефекты, которые здесь зафиксированы:
 *   L1 — клип искали запросом `videoAsset.findFirst({ order: scene.order })`.
 *        scene.order из storyPlan 1-based, а VideoAsset(type=clip).order —
 *        0-based индекс цикла генерации: реплика сцены N уезжала на клип N+1,
 *        а последняя сцена всегда получала «не найден клип в БД».
 *   L2 — источником брался clipAsset.filePath, куда прошлый прогон записывал
 *        *_lipsync.mp4, и подстановка в clipPaths шла через findIndex по строке.
 *        При повторном заходе синхронизация ложилась поверх синхронизации,
 *        а findIndex возвращал -1 и результат вообще не попадал в сборку.
 *   L3 — рестарт шага заново оплачивал TTS и lip-sync уже готовых сцен.
 *   L4 — исходник отдавался модели без проверки реальной длительности:
 *        клип вне диапазона 2-10 с ломал сцену вместо того, чтобы быть пропущен.
 *
 * Всё DB-free: prisma/tts/lip-sync/storage замоканы, файлы — только в tmpdir.
 */

import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildLipSyncReuseKey, hashSpokenLine } from "../../../server/utils/presenter/scene-clip-mapping"
import { runLipSyncStep } from "../../../server/utils/lip-sync-runner"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

interface LipSyncCallArgs {
  sourceVideoPath: string
  outputPath: string
  audioPath: string
  sceneOrder: number
  durationSec: number
  videoAssetId: string | null
}

const h = vi.hoisted(() => ({
  /** Каталог ассетов видео — подменяем на tmpdir, чтобы не писать в storage проекта. */
  assetsDir: "",
  stepCompleted: false,
  step: { id: 101, attemptCount: 0, outputSnapshot: null as unknown },
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
    videoAsset: {
      findFirst: h.assetFindFirst,
      update: h.assetUpdate,
    },
    // Порядок нарезки клипов runner берёт из снапшота prompt_generation. Здесь он
    // тождественный (order N → клип N-1) — тесты этого файла проверяют не порядок,
    // а привязку и деньги. Без снапшота шаг честно пропускает все сцены.
    videoGenerationStep: {
      findFirst: async () => ({
        outputSnapshot: { scenePrompts: { scenes: [1, 2, 3, 4, 5].map(order => ({ order, prompt: "p" })) } },
      }),
    },
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

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-runner-fixes")
h.assetsDir = ASSETS_DIR

const clipPath = (index: number) => join(ASSETS_DIR, `scene_${index}_clip.mp4`)
const lipSyncPath = (index: number) => join(ASSETS_DIR, `scene_${index}_lipsync.mp4`)
const audioPath = (index: number) => join(ASSETS_DIR, `scene_${index}_spoken.mp3`)

const VIDEO_CONFIG = {
  lipSyncEnabled: true,
  lipSyncModelId: null,
  lipSyncCharacterId: null,
  voiceoverModelId: null,
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as const,
}

/**
 * Отпечаток сцены в снапшоте — тот же, что считает runner (buildLipSyncReuseKey).
 * Запись без него считается записью старого формата и не переиспользуется.
 */
async function reuseKeyFor(spokenLine: string, sourcePath: string): Promise<string> {
  let sourceSignature: string | null = null
  try {
    const stats = await stat(sourcePath)
    sourceSignature = `${stats.size}:${Math.round(stats.mtimeMs)}`
  } catch { /* файла нет — runner тоже получит null */ }
  return buildLipSyncReuseKey({
    spokenLine,
    sourcePath,
    sourceSignature,
    lipSyncCharacterId: VIDEO_CONFIG.lipSyncCharacterId,
    lipSyncModelId: VIDEO_CONFIG.lipSyncModelId,
    voiceoverModelId: VIDEO_CONFIG.voiceoverModelId,
    voiceoverVoiceId: VIDEO_CONFIG.voiceoverVoiceId,
    voiceoverLanguage: VIDEO_CONFIG.voiceoverLanguage,
    voiceoverPacing: VIDEO_CONFIG.voiceoverPacing,
  })
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

  h.stepCompleted = false
  h.step = { id: 101, attemptCount: 0, outputSnapshot: null }
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
  // TTS «пишет» файл — это важно для проверки переиспользования аудио.
  h.synthesizeSpeech.mockImplementation(async (args: { outputPath: string }) => {
    await writeFile(args.outputPath, "tts")
    return { costUsd: 0.002 }
  })

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

describe("runLipSyncStep: привязка сцены к клипу", () => {
  const threeScenes = () => makePlan([
    { order: 1, spokenLine: "Реплика один", durationSec: 5 },
    { order: 2, spokenLine: "Реплика два", durationSec: 5 },
    { order: 3, spokenLine: "Реплика три", durationSec: 5 },
  ])

  function seedThreeClips() {
    for (let i = 0; i < 3; i++) {
      h.clipAssets.set(i, { id: `asset-${i}`, filePath: clipPath(i) })
    }
    return [clipPath(0), clipPath(1), clipPath(2)]
  }

  it("сцена с 1-based order синхронизирует свой клип, а не соседний", async () => {
    const clipPaths = seedThreeClips()

    const result = await runLipSyncStep({ videoId: 7, clipPaths, videoPlan: threeScenes(), videoConfig: VIDEO_CONFIG })

    const calls = lipSyncCalls()
    expect(calls).toHaveLength(3)
    // scene.order=1 обязана уехать в клип с индексом 0 (раньше брался индекс 1).
    expect(calls[0]!.sceneOrder).toBe(1)
    expect(calls[0]!.sourceVideoPath).toBe(clipPath(0))
    expect(calls[0]!.outputPath).toBe(lipSyncPath(0))
    expect(calls[1]!.sourceVideoPath).toBe(clipPath(1))
    expect(calls[2]!.sourceVideoPath).toBe(clipPath(2))
    expect(result.status).toBe("completed")
  })

  it("последняя сцена не теряется: синхронизированы все три клипа", async () => {
    const clipPaths = seedThreeClips()

    const result = await runLipSyncStep({ videoId: 7, clipPaths, videoPlan: threeScenes(), videoConfig: VIDEO_CONFIG })

    // Раньше scene.order=3 искала VideoAsset.order=3, которого нет → сцена молча выпадала.
    expect(result.syncedSceneCount).toBe(3)
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1), lipSyncPath(2)])
  })

  it("результат подставляется по индексу сцены, даже если filePath в БД уже другой", async () => {
    const clipPaths = seedThreeClips()
    // Прошлый прогон старого кода переписал filePath ассета на свой же результат.
    h.clipAssets.set(1, { id: "asset-1", filePath: lipSyncPath(1) })

    const result = await runLipSyncStep({ videoId: 7, clipPaths, videoPlan: threeScenes(), videoConfig: VIDEO_CONFIG })

    // findIndex по строке здесь возвращал -1 и результат сцены просто исчезал.
    expect(result.clipPaths[1]).toBe(lipSyncPath(1))
    expect(result.syncedSceneCount).toBe(3)
  })
})

describe("runLipSyncStep: повторный заход", () => {
  it("источником берётся оригинальный клип, а не результат прошлого lip-sync", async () => {
    const clipPaths = [clipPath(0)]
    // Типовое состояние после старого прогона: в БД лежит уже синхронизированный файл.
    // Ассет продублирован на order=1, чтобы старый (1-based) поиск тоже что-то нашёл —
    // тест обязан ловить именно подмену источника, а не промах индексации.
    h.clipAssets.set(0, { id: "asset-0", filePath: lipSyncPath(0) })
    h.clipAssets.set(1, { id: "asset-0", filePath: lipSyncPath(0) })

    await runLipSyncStep({
      videoId: 7,
      clipPaths,
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика один", durationSec: 5 }]),
      videoConfig: VIDEO_CONFIG,
    })

    const calls = lipSyncCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sourceVideoPath).toBe(clipPath(0))
    expect(calls[0]!.sourceVideoPath).not.toBe(lipSyncPath(0))
  })

  it("filePath у VideoAsset не переписывается на lip-sync результат", async () => {
    const clipPaths = [clipPath(0)]
    // Дубль на order=1 — чтобы старая (1-based) выборка тоже дошла до записи filePath.
    h.clipAssets.set(0, { id: "asset-0", filePath: clipPath(0) })
    h.clipAssets.set(1, { id: "asset-0", filePath: clipPath(0) })

    await runLipSyncStep({
      videoId: 7,
      clipPaths,
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика один", durationSec: 5 }]),
      videoConfig: VIDEO_CONFIG,
    })

    // Иначе следующий заход подсунет синхронизированный файл сам себе на вход.
    expect(h.assetUpdate).not.toHaveBeenCalled()
  })

  it("готовая сцена из снапшота не оплачивается повторно", async () => {
    const clipPaths = [clipPath(0), clipPath(1)]
    h.clipAssets.set(0, { id: "asset-0", filePath: clipPath(0) })
    h.clipAssets.set(1, { id: "asset-1", filePath: clipPath(1) })
    // Сцена 0 доехала в прошлый раз: файл на диске, текст реплики не менялся.
    await writeFile(lipSyncPath(0), "already-synced")
    await writeFile(audioPath(0), "already-tts")
    h.step.outputSnapshot = {
      scenes: [{
        sceneOrder: 1,
        sceneIndex: 0,
        sourcePath: clipPath(0),
        outputPath: lipSyncPath(0),
        audioPath: audioPath(0),
        spokenLineHash: hashSpokenLine("Реплика один"),
        reuseKey: await reuseKeyFor("Реплика один", clipPath(0)),
        durationSec: 5,
      }],
    }

    const result = await runLipSyncStep({
      videoId: 7,
      clipPaths,
      videoPlan: makePlan([
        { order: 1, spokenLine: "Реплика один", durationSec: 5 },
        { order: 2, spokenLine: "Реплика два", durationSec: 5 },
      ]),
      videoConfig: VIDEO_CONFIG,
    })

    const calls = lipSyncCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sceneOrder).toBe(2)
    expect(h.synthesizeSpeech).toHaveBeenCalledTimes(1)
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1)])
    expect(result.syncedSceneCount).toBe(2)
  })

  it("изменённая реплика заставляет пересинхронизировать сцену", async () => {
    const clipPaths = [clipPath(0)]
    h.clipAssets.set(0, { id: "asset-0", filePath: clipPath(0) })
    await writeFile(lipSyncPath(0), "already-synced")
    h.step.outputSnapshot = {
      scenes: [{
        sceneOrder: 1,
        sceneIndex: 0,
        sourcePath: clipPath(0),
        outputPath: lipSyncPath(0),
        audioPath: audioPath(0),
        spokenLineHash: hashSpokenLine("Старая реплика"),
        reuseKey: await reuseKeyFor("Старая реплика", clipPath(0)),
        durationSec: 5,
      }],
    }

    await runLipSyncStep({
      videoId: 7,
      clipPaths,
      videoPlan: makePlan([{ order: 1, spokenLine: "Новая реплика", durationSec: 5 }]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(h.synthesizeSpeech).toHaveBeenCalledTimes(1)
  })
})

describe("runLipSyncStep: диапазон длительности модели", () => {
  it("сцена с источником вне 2-10 с пропускается, оригинал остаётся в сборке", async () => {
    const clipPaths = [clipPath(0), clipPath(1), clipPath(2)]
    for (let i = 0; i < 3; i++) h.clipAssets.set(i, { id: `asset-${i}`, filePath: clipPath(i) })
    // Дубль на order=3 — чтобы старая (1-based) выборка не теряла последнюю сцену
    // и тест ловил именно отсутствие проверки длительности.
    h.clipAssets.set(3, { id: "asset-2", filePath: clipPath(2) })
    // Клип средней сцены реально длиннее максимума kling-lip-sync.
    h.durationByPath.set(clipPath(1), 12.4)

    const result = await runLipSyncStep({
      videoId: 7,
      clipPaths,
      videoPlan: makePlan([
        { order: 1, spokenLine: "Реплика один", durationSec: 5 },
        { order: 2, spokenLine: "Реплика два", durationSec: 5 },
        { order: 3, spokenLine: "Реплика три", durationSec: 5 },
      ]),
      videoConfig: VIDEO_CONFIG,
    })

    const sources = lipSyncCalls().map(c => c.sourceVideoPath)
    expect(sources).toEqual([clipPath(0), clipPath(2)])
    expect(result.clipPaths[1]).toBe(clipPath(1))
    expect(result.syncedSceneCount).toBe(2)
    // Нет смысла платить за TTS сцены, которую всё равно не отдадим модели.
    expect(h.synthesizeSpeech).toHaveBeenCalledTimes(2)
  })

  it("модели отдаётся измеренная длительность источника, а не плановая", async () => {
    const clipPaths = [clipPath(0)]
    h.clipAssets.set(0, { id: "asset-0", filePath: clipPath(0) })
    h.clipAssets.set(1, { id: "asset-0", filePath: clipPath(0) })
    h.durationByPath.set(clipPath(0), 7.25)

    await runLipSyncStep({
      videoId: 7,
      clipPaths,
      // План говорит 5 с, на диске — 7.25 с; платим и синхронизируем по факту.
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика один", durationSec: 5 }]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(lipSyncCalls()[0]!.durationSec).toBeCloseTo(7.25, 5)
  })

  // L5: диапазон модели не ловит исходник ведущего чужой длины — 2.5с ∈ [2,10],
  // а сцена на 9с в сборке становилась 2.5-секундной.
  it("исходник ведущего, не совпадающий с плановой длиной сцены, отбрасывается", async () => {
    const clipPaths = [clipPath(0)]
    h.clipAssets.set(0, { id: "asset-0", filePath: clipPath(0) })
    const presenterPath = join(ASSETS_DIR, "presenter_0_src-1.mp4")
    h.reservePresenterSourceClip.mockResolvedValue({
      id: "src-1",
      name: "src-1.mp4",
      fileUrl: "https://example.invalid/src-1.mp4",
      storageKey: null,
      durationSec: 9,
    })
    // Метаданные в БД врут: реальный файл короче сцены на 6.5 с.
    h.durationByPath.set(presenterPath, 2.5)
    h.durationByPath.set(clipPath(0), 9)

    await runLipSyncStep({
      videoId: 7,
      clipPaths,
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика один", durationSec: 9 }]),
      videoConfig: { ...VIDEO_CONFIG, lipSyncCharacterId: "char-1" },
    })

    const calls = lipSyncCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sourceVideoPath).toBe(clipPath(0))
    expect(calls[0]!.durationSec).toBeCloseTo(9, 5)
  })

  it("границы модели передаются в подбор исходника ведущего", async () => {
    const clipPaths = [clipPath(0)]
    h.clipAssets.set(0, { id: "asset-0", filePath: clipPath(0) })
    h.clipAssets.set(1, { id: "asset-0", filePath: clipPath(0) })

    await runLipSyncStep({
      videoId: 7,
      clipPaths,
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика один", durationSec: 6 }]),
      videoConfig: { ...VIDEO_CONFIG, lipSyncCharacterId: "char-1" },
    })

    // Без этих границ селектор возвращал клип любой длины (см. presenter-source-duration-range).
    expect(h.reservePresenterSourceClip).toHaveBeenCalledWith({
      characterId: "char-1",
      durationSec: 6,
      minDurationSec: 2,
      maxDurationSec: 10,
    })
  })
})
