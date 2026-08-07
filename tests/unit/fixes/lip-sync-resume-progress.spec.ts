/**
 * Регрессия L6-L8: «resume без повторной оплаты» не срабатывал ровно в том сценарии,
 * ради которого делался — при обрыве в середине шага lip-sync.
 *
 *   L6 — outputSnapshot со сценами писался ОДНИМ куском после цикла, вместе со
 *        status:'completed'. Исключение в середине (упавший uploadLocalAsset,
 *        перезапуск воркера) оставляло снапшот null: следующий прогон заново платил
 *        за TTS и Replicate по уже готовым сценам, а расходы упавшей попытки не
 *        попадали ни в ledger, ни в actualCost.
 *   L7 — клип сцены искался по позиции в videoPlan.scenes, хотя нарезка идёт по
 *        prompts.scenePrompts.scenes, порядок которых задаёт Claude.
 *   L8 — ранняя ветка идемпотентности возвращала кэш, не проверяя, что в снапшоте
 *        есть все сцены с репликой.
 *
 * DB-free: prisma/tts/lip-sync/storage замоканы, файлы — только в tmpdir.
 */

import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildLipSyncReuseKey, hashSpokenLine } from "../../../server/utils/presenter/scene-clip-mapping"
import { runLipSyncStep } from "../../../server/utils/lip-sync-runner"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

interface SceneRecordLike {
  sceneIndex: number
  outputPath: string
  audioPath: string | null
  spokenLineHash: string | null
}

const h = vi.hoisted(() => ({
  assetsDir: "",
  stepCompleted: false,
  step: { id: 202, attemptCount: 0, outputSnapshot: null as unknown },
  clipAssets: new Map<number, { id: string; filePath: string }>(),
  promptSnapshot: null as unknown,
  assetFindFirst: vi.fn(),
  stepFindFirst: vi.fn(),
  appendStepLog: vi.fn(),
  updateStep: vi.fn(),
  synthesizeSpeech: vi.fn(),
  runLipSync: vi.fn(),
  uploadLocalAsset: vi.fn(),
  logStepCost: vi.fn(),
}))

vi.mock("../../../server/utils/prisma", () => ({
  prisma: {
    videoAsset: { findFirst: h.assetFindFirst },
    videoGenerationStep: { findFirst: h.stepFindFirst },
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
vi.mock("../../../server/utils/render", () => ({
  probeMediaDuration: async () => 5,
}))
vi.mock("../../../server/utils/presenter-source-selector", () => ({
  reservePresenterSourceClip: async () => null,
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: h.logStepCost }))
vi.mock("../../../server/utils/storage-paths", () => ({ getAssetsDirFor: () => h.assetsDir }))
vi.mock("../../../server/utils/storage", () => ({
  getStorageDriver: () => ({ downloadToFile: async () => undefined }),
}))
vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: (...args: unknown[]) => h.uploadLocalAsset(...args),
}))
vi.mock("../../../server/utils/video-helpers", () => ({ downloadFile: async () => undefined }))

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-resume-progress")
h.assetsDir = ASSETS_DIR

const clipPath = (index: number) => join(ASSETS_DIR, `scene_${index}_clip.mp4`)
const lipSyncPath = (index: number) => join(ASSETS_DIR, `scene_${index}_lipsync.mp4`)

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
 * Запись без него читается как «старый формат» и не переиспользуется.
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

function makePlan(scenes: Array<{ order: number; spokenLine: string | null; durationSec: number }>): StoryDrivenVideoPlan {
  return { mode: "story_driven", scenes, totalDurationSec: 0 } as unknown as StoryDrivenVideoPlan
}

/** Последний снапшот, записанный через updateStep — то, что переживёт рестарт. */
function lastSnapshot(): { scenes?: SceneRecordLike[]; clipPaths?: string[] } | null {
  for (let i = h.updateStep.mock.calls.length - 1; i >= 0; i--) {
    const payload = h.updateStep.mock.calls[i]![1] as { outputSnapshot?: unknown }
    if (payload?.outputSnapshot) return payload.outputSnapshot as { scenes?: SceneRecordLike[] }
  }
  return null
}

beforeEach(async () => {
  await rm(ASSETS_DIR, { recursive: true, force: true })
  await mkdir(ASSETS_DIR, { recursive: true })

  h.stepCompleted = false
  h.step = { id: 202, attemptCount: 0, outputSnapshot: null }
  h.clipAssets.clear()
  // Тождественный порядок нарезки по умолчанию: без снапшота prompt_generation шаг
  // теперь честно пропускает сцены, а эти тесты про деньги и прогресс, не про порядок.
  h.promptSnapshot = { scenePrompts: { scenes: [1, 2, 3, 4, 5].map(order => ({ order, prompt: "p" })) } }

  h.assetFindFirst.mockReset()
  h.assetFindFirst.mockImplementation(async (args: { where: { order: number } }) =>
    h.clipAssets.get(args.where.order) ?? null)
  h.stepFindFirst.mockReset()
  h.stepFindFirst.mockImplementation(async () => ({ outputSnapshot: h.promptSnapshot }))
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
  h.runLipSync.mockImplementation(async (req: { outputPath: string }) => ({
    costUsd: 0.07,
    provider: "replicate",
    outputPath: req.outputPath,
  }))

  h.uploadLocalAsset.mockReset()
  h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => ({
    storageKey,
    storageProvider: "local",
    storageBucket: null,
  }))
})

function fiveScenes() {
  return makePlan([1, 2, 3, 4, 5].map(order => ({
    order,
    spokenLine: `Реплика ${order}`,
    durationSec: 5,
  })))
}

function seedClips(count: number): string[] {
  const paths: string[] = []
  for (let i = 0; i < count; i++) {
    h.clipAssets.set(i, { id: `asset-${i}`, filePath: clipPath(i) })
    paths.push(clipPath(i))
  }
  return paths
}

describe("runLipSyncStep: обрыв в середине шага", () => {
  it("готовые сцены попадают в снапшот до падения", async () => {
    const clipPaths = seedClips(5)
    // Заливка падает на четвёртой сцене — ровно как отвалившийся storage в проде.
    h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => {
      if (String(storageKey).includes("scene_3_lipsync")) throw new Error("storage недоступен")
      return { storageKey, storageProvider: "local", storageBucket: null }
    })

    await expect(runLipSyncStep({
      videoId: 9,
      clipPaths,
      videoPlan: fiveScenes(),
      videoConfig: VIDEO_CONFIG,
    })).rejects.toThrow("storage недоступен")

    const snapshot = lastSnapshot()
    // Раньше снапшот писался только вместе со status:'completed' — здесь был null,
    // и повторный прогон переоплачивал сцены 0-3.
    expect(snapshot?.scenes?.map(s => s.sceneIndex)).toEqual([0, 1, 2, 3])
  })

  it("расходы прерванной попытки уходят в ledger", async () => {
    const clipPaths = seedClips(3)
    h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => {
      if (String(storageKey).includes("scene_2_lipsync")) throw new Error("storage недоступен")
      return { storageKey, storageProvider: "local", storageBucket: null }
    })

    await expect(runLipSyncStep({
      videoId: 9,
      clipPaths,
      videoPlan: makePlan([1, 2, 3].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })).rejects.toThrow()

    // Три сцены оплачены (0.072 каждая), ledger обязан их увидеть — иначе
    // burn-rate теряет всю попытку.
    expect(h.logStepCost).toHaveBeenCalledTimes(1)
    const [, , service, costUsd] = h.logStepCost.mock.calls[0]!
    expect(service).toBe("replicate")
    expect(costUsd).toBeCloseTo(0.072 * 3, 5)
  })

  it("повторный заход не переоплачивает сцены из частичного снапшота", async () => {
    const clipPaths = seedClips(3)
    // Состояние после обрыва: шаг в статусе running, снапшот частичный.
    for (const index of [0, 1]) await writeFile(lipSyncPath(index), "already-synced")
    h.step = {
      id: 202,
      attemptCount: 1,
      outputSnapshot: {
        scenes: await Promise.all([0, 1].map(async index => ({
          sceneOrder: index + 1,
          sceneIndex: index,
          sourcePath: clipPath(index),
          outputPath: lipSyncPath(index),
          audioPath: null,
          spokenLineHash: hashSpokenLine(`Реплика ${index + 1}`),
          reuseKey: await reuseKeyFor(`Реплика ${index + 1}`, clipPath(index)),
          durationSec: 5,
        }))),
      },
    }

    const result = await runLipSyncStep({
      videoId: 9,
      clipPaths,
      videoPlan: makePlan([1, 2, 3].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })

    // Платим только за третью сцену.
    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(h.synthesizeSpeech).toHaveBeenCalledTimes(1)
    expect(result.syncedSceneCount).toBe(3)
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1), lipSyncPath(2)])
  })

  it("записи прошлых попыток не стираются теми, до кого прогон не дошёл", async () => {
    const clipPaths = seedClips(3)
    // Сцена 2 готова с прошлого раза, у сцены 0 сменился текст → пересинхрон,
    // и на нём же прогон падает.
    await writeFile(lipSyncPath(2), "already-synced")
    h.step = {
      id: 202,
      attemptCount: 1,
      outputSnapshot: {
        scenes: [{
          sceneOrder: 3,
          sceneIndex: 2,
          sourcePath: clipPath(2),
          outputPath: lipSyncPath(2),
          audioPath: null,
          spokenLineHash: hashSpokenLine("Реплика 3"),
          reuseKey: await reuseKeyFor("Реплика 3", clipPath(2)),
          durationSec: 5,
        }],
      },
    }
    h.uploadLocalAsset.mockImplementation(async () => { throw new Error("storage недоступен") })

    await expect(runLipSyncStep({
      videoId: 9,
      clipPaths,
      videoPlan: makePlan([
        { order: 1, spokenLine: "Новая реплика 1", durationSec: 5 },
        { order: 2, spokenLine: "Реплика 2", durationSec: 5 },
        { order: 3, spokenLine: "Реплика 3", durationSec: 5 },
      ]),
      videoConfig: VIDEO_CONFIG,
    })).rejects.toThrow()

    const snapshot = lastSnapshot()
    expect(snapshot?.scenes?.map(s => s.sceneIndex)).toContain(2)
  })
})

describe("runLipSyncStep: порядок клипов от Claude", () => {
  it("реплика ложится на клип своей сцены при переставленных промптах", async () => {
    const clipPaths = seedClips(5)
    // Claude вернул scenePrompts в порядке 1,2,4,3,5 — clipPaths[2] это сцена 4.
    h.promptSnapshot = { scenePrompts: { scenes: [1, 2, 4, 3, 5].map(order => ({ order, prompt: "p", purpose: "x" })) } }

    await runLipSyncStep({
      videoId: 9,
      clipPaths,
      videoPlan: fiveScenes(),
      videoConfig: VIDEO_CONFIG,
    })

    const byOrder = new Map(h.runLipSync.mock.calls.map(call => {
      const args = call[0] as { sceneOrder: number; sourceVideoPath: string }
      return [args.sceneOrder, args.sourceVideoPath]
    }))
    expect(byOrder.get(3)).toBe(clipPath(3))
    expect(byOrder.get(4)).toBe(clipPath(2))
  })

  it("явный clipSceneOrders важнее снапшота prompt_generation", async () => {
    const clipPaths = seedClips(3)
    h.promptSnapshot = { scenePrompts: { scenes: [1, 2, 3].map(order => ({ order, prompt: "p", purpose: "x" })) } }

    await runLipSyncStep({
      videoId: 9,
      clipPaths,
      clipSceneOrders: [3, 2, 1],
      videoPlan: makePlan([1, 2, 3].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })

    const first = h.runLipSync.mock.calls[0]![0] as { sceneOrder: number; sourceVideoPath: string }
    expect(first.sceneOrder).toBe(1)
    expect(first.sourceVideoPath).toBe(clipPath(2))
  })
})

describe("runLipSyncStep: ранняя идемпотентность", () => {
  it("completed-шаг с неполным снапшотом досинхронизирует недостающую сцену", async () => {
    const clipPaths = seedClips(2)
    await writeFile(lipSyncPath(0), "already-synced")
    h.stepCompleted = true
    h.step = {
      id: 202,
      attemptCount: 1,
      outputSnapshot: {
        status: "completed",
        clipPaths: [lipSyncPath(0), clipPath(1)],
        scenes: [{
          sceneOrder: 1,
          sceneIndex: 0,
          sourcePath: clipPath(0),
          outputPath: lipSyncPath(0),
          audioPath: null,
          spokenLineHash: hashSpokenLine("Реплика 1"),
          reuseKey: await reuseKeyFor("Реплика 1", clipPath(0)),
          durationSec: 5,
        }],
      },
    }

    const result = await runLipSyncStep({
      videoId: 9,
      clipPaths,
      videoPlan: makePlan([1, 2].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })

    // Раньше ранний return отдавал кэш и вторая сцена оставалась несинхронизированной навсегда.
    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1)])
  })

  it("полный снапшот у completed-шага возвращается без работы", async () => {
    const clipPaths = seedClips(2)
    h.stepCompleted = true
    h.step = {
      id: 202,
      attemptCount: 1,
      outputSnapshot: {
        status: "completed",
        clipPaths: [lipSyncPath(0), lipSyncPath(1)],
        scenes: await Promise.all([0, 1].map(async index => ({
          sceneOrder: index + 1,
          sceneIndex: index,
          sourcePath: clipPath(index),
          outputPath: lipSyncPath(index),
          audioPath: null,
          spokenLineHash: hashSpokenLine(`Реплика ${index + 1}`),
          reuseKey: await reuseKeyFor(`Реплика ${index + 1}`, clipPath(index)),
          durationSec: 5,
        }))),
      },
    }

    const result = await runLipSyncStep({
      videoId: 9,
      clipPaths,
      videoPlan: makePlan([1, 2].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(result.clipPaths).toEqual([lipSyncPath(0), lipSyncPath(1)])
  })
})
