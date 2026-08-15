/**
 * Регрессия на шаг clip_generation целиком: список клипов адресуется позицией
 * сцены, а не порядком, в котором файлы легли в массив.
 *
 * Дефект (ролик 23): сцены ведущей клип не получают, и `clipPaths.push(...)`
 * давал 6 путей на 9 сцен. Потребители (lip-sync, озвучка, субтитры) при этом
 * берут клип по ИНДЕКСУ СЦЕНЫ — клип сцены 6 оказывался на месте сцены 3, а
 * сцены с индексом ≥ 6 выпадали с логом «индекс клипа вне списка».
 *
 * DB-free: prisma, media-provider, storage и ffmpeg-обёртки замоканы.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import type { PromptGenerationResult } from "../../../server/utils/video-pipeline-db"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const h = vi.hoisted(() => ({
  step: { id: 5, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  stepCompleted: false,
  logs: [] as string[],
  snapshots: [] as Record<string, unknown>[],
  /** Клипы, которые «уже лежат в БД» (order → filePath). */
  clipAssets: new Map<number, { id: string; filePath: string }>(),
  mediaCalls: [] as Array<{ unitKey: string; sceneOrder: number }>,
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async (_id: number, patch: Record<string, unknown>) => {
    if (patch.outputSnapshot) h.snapshots.push(patch.outputSnapshot as Record<string, unknown>)
  },
  appendStepLog: async (_id: number, line: string) => { h.logs.push(line) },
  isStepCompleted: () => h.stepCompleted,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/media-provider/registry", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../server/utils/media-provider/registry")>(),
  resolveMediaRoute: () => ({ primary: { id: "replicate/kling" }, fallback: null }),
}))

vi.mock("../../../server/utils/media-provider/run-media-task", () => ({
  runMediaTask: async (req: { unitKey: string; sceneOrder: number; outputPath: string }) => {
    h.mediaCalls.push({ unitKey: req.unitKey, sceneOrder: req.sceneOrder })
    return {
      localPath: req.outputPath,
      source: "generated",
      effectiveDurationSec: 5,
      storage: { storageKey: `k/${req.unitKey}`, storageProvider: "local" },
    }
  },
}))

vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: async (_p: string, storageKey: string) => ({ storageKey, storageProvider: "local" }),
}))
vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: () => "/api/files/x.mp4",
}))
vi.mock("../../../server/utils/video-tools/still-clip-runner", () => ({
  renderStillClip: async () => undefined,
}))
vi.mock("../../../server/utils/media-provider/reference-frame", () => ({
  loadReferenceFrames: async () => new Map(),
  normalizeSceneReferenceFrame: () => null,
  referenceFrameKey: () => "k",
}))
vi.mock("../../../server/utils/media-provider/reference-frame-repository", () => ({
  createReferenceFrameDeps: () => ({}),
  materializeReferenceFrame: async () => null,
}))

/** Автоимпорты Nuxt: в чистом vitest их нет — шаг обращается к ним как к глобалам. */
function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.getAssetsDir = () => tmpdir()
  g.ensureDir = async () => {}
  g.logAgent = async () => {}
  g.prisma = {
    videoAsset: {
      findFirst: async (args: { where: { order: number } }) => h.clipAssets.get(args.where.order) ?? null,
      create: async () => ({ id: "a1" }),
      update: async () => ({ id: "a1" }),
    },
  }
}

/** Девять сцен, три из которых играет ведущая (позиции 1, 4, 7). */
const NINE_SCENES = [1, 2, 3, 4, 5, 6, 7, 8, 9]

function promptsFor(orders: number[]): PromptGenerationResult {
  return {
    hook: "h",
    body: "b",
    cta: "c",
    scenePrompts: { scenes: orders.map(order => ({ order, prompt: `prompt-${order}` })) },
  } as unknown as PromptGenerationResult
}

function planFor(orders: number[]): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: orders.map(order => ({ order, durationSec: 5 })),
  } as unknown as StoryDrivenVideoPlan
}

async function loadSteps() {
  installGlobals()
  return await import("../../../server/utils/video-pipeline-steps")
}

beforeEach(() => {
  h.step = { id: 5, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.stepCompleted = false
  h.logs.length = 0
  h.snapshots.length = 0
  h.clipAssets.clear()
  h.mediaCalls.length = 0
})

describe("runClipGeneration: длина списка клипов равна числу сцен", () => {
  it("сцены ведущей оставляют пустую ячейку, а не сдвигают остальные клипы", async () => {
    const steps = await loadSteps()
    const presenter = new Set([1, 4, 7])

    const result = await steps.runClipGeneration(
      23, promptsFor(NINE_SCENES), "portrait", 5, "replicate/kling", false,
      planFor(NINE_SCENES), null, presenter,
    )

    expect(result.clipPaths).toHaveLength(9)
    // Ячейки ведущей пусты, остальные — свой клип на своём месте.
    expect(result.clipPaths.map(p => (p ? p.split(/[\\/]/).pop() : ""))).toEqual([
      "scene_1_clip.mp4", "", "scene_3_clip.mp4", "scene_4_clip.mp4", "",
      "scene_6_clip.mp4", "scene_7_clip.mp4", "", "scene_9_clip.mp4",
    ])
    // Платных вызовов ровно по числу сцен без ведущей — правка не должна начать
    // генерировать клипы сценам, которые играет живой человек.
    expect(h.mediaCalls.map(c => c.sceneOrder)).toEqual([0, 2, 3, 5, 6, 8])
  })

  it("в снапшот шага уезжает тот же список по сценам", async () => {
    const steps = await loadSteps()

    await steps.runClipGeneration(
      23, promptsFor(NINE_SCENES), "portrait", 5, "replicate/kling", false,
      planFor(NINE_SCENES), null, new Set([1, 4, 7]),
    )

    const snapshot = h.snapshots.at(-1)!
    expect((snapshot.clipPaths as string[]).length).toBe(9)
    expect((snapshot.clipPaths as string[])[1]).toBe("")
  })

  it("клип, поднятый с диска, встаёт на место своей сцены", async () => {
    const steps = await loadSteps()
    // Ассет сцены с индексом 5 уже есть — путь заведомо существующий (сам файл теста).
    h.clipAssets.set(5, { id: "old", filePath: import.meta.filename })

    const result = await steps.runClipGeneration(
      23, promptsFor(NINE_SCENES), "portrait", 5, "replicate/kling", false,
      planFor(NINE_SCENES), null, new Set([1, 4, 7]),
    )

    expect(result.clipPaths[5]).toBe(import.meta.filename)
    expect(h.mediaCalls.map(c => c.sceneOrder)).not.toContain(5)
  })
})

describe("runClipGeneration: снапшот прошлого прогона", () => {
  it("плотный список старого формата разворачивается по сценам", async () => {
    const steps = await loadSteps()
    h.stepCompleted = true
    h.step = {
      id: 5,
      attemptCount: 1,
      actualCost: 0,
      outputSnapshot: {
        clipPaths: ["c0.mp4", "c2.mp4", "c3.mp4", "c5.mp4", "c6.mp4", "c8.mp4"],
        presenterSceneIndexes: [1, 4, 7],
        perSceneDurations: NINE_SCENES.map((_, idx) => ({ key: `scene_${idx + 1}`, order: idx, durationSec: 5 })),
      },
    }

    const result = await steps.runClipGeneration(
      23, promptsFor(NINE_SCENES), "portrait", 5, "replicate/kling", false,
      planFor(NINE_SCENES), null, new Set([1, 4, 7]),
    )

    expect(result.clipPaths).toEqual([
      "c0.mp4", "", "c2.mp4", "c3.mp4", "", "c5.mp4", "c6.mp4", "", "c8.mp4",
    ])
    // Кэш остаётся кэшем: платных вызовов быть не должно.
    expect(h.mediaCalls).toHaveLength(0)
  })

  it("снапшот, который не сходится по арифметике, пересобирается, а не отдаётся как есть", async () => {
    const steps = await loadSteps()
    h.stepCompleted = true
    h.step = {
      id: 5,
      attemptCount: 1,
      actualCost: 0,
      // Четыре пути + три сцены ведущей ≠ девять сцен: чья ячейка чья — неизвестно.
      outputSnapshot: { clipPaths: ["c0.mp4", "c1.mp4", "c2.mp4", "c3.mp4"], presenterSceneIndexes: [1, 4, 7] },
    }

    const result = await steps.runClipGeneration(
      23, promptsFor(NINE_SCENES), "portrait", 5, "replicate/kling", false,
      planFor(NINE_SCENES), null, new Set([1, 4, 7]),
    )

    expect(result.clipPaths).toHaveLength(9)
    expect(h.logs.some(l => l.includes("снапшот") || l.includes("Снапшот"))).toBe(true)
  })
})
