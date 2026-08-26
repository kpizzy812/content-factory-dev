/**
 * Кадры разбитой реплики берут картинку из СВОЕЙ части (spec §5.3).
 *
 * Реплика длиннее потолка lip-sync модели уходит в модель несколькими
 * вызовами, и каждая часть — отдельный файл, начинающийся со своей секунды
 * трека. Кадр — подотрезок клипа ЧАСТИ, а не сцены: считай композиция
 * смещение от начала сцены, кадр второй части залез бы за конец своего файла
 * и показал бы чужие (или замороженные) кадры под живую речь. Ровно тот же
 * класс дефекта, что и «липсинк застыл в конце» на ролике 30, только с другой
 * стороны.
 *
 * Числа настоящие: сцена 9 ролика 30 идёт 79.57-90.93 (11.36с при потолке
 * 10с), рез по паузе даёт части 79.57-85.30 и 85.30-90.93.
 *
 * Приём мокирования — тот же, что у `shot-presenter-live-window.spec.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCENE_START = 79.57
const SCENE_CUT = 85.3
const SCENE_END = 90.93

const h = vi.hoisted(() => ({
  measuredByPath: new Map<string, number>(),
  shotRows: [] as Array<Record<string, unknown>>,
  assetRows: [] as Array<Record<string, unknown>>,
  compositions: [] as Array<Record<string, unknown>>,
  lipSyncSnapshot: null as unknown,
}))

vi.mock("../../../server/utils/video-tools/shot-compose-runner", () => ({
  renderShotComposition: async (request: { composition: Record<string, unknown> }) => {
    h.compositions.push(request.composition)
  },
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => ({ id: 7, attemptCount: 0, actualCost: 0, outputSnapshot: h.lipSyncSnapshot }),
  updateStep: async () => {},
  appendStepLog: async () => {},
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
  STEP_ORDER: [
    "prompt_generation", "image_generation", "clip_generation", "voiceover_generation",
    "transcription", "edit_plan", "shot_background", "music_generation",
    "lip_sync_generation", "assembly",
  ],
}))

vi.mock("../../../server/utils/render", () => ({
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeSceneClipDurations: async (paths: string[]) => paths.map(() => 5),
  probeClipDurations: async (paths: string[]) => paths.map(() => 5),
  probeMediaDuration: async (path: string) => h.measuredByPath.get(path) ?? null,
  adjustAudioTempo: async () => ({ outputPath: "x", durationSec: 1 }),
  trimAudio: async () => ({ outputPath: "x", durationSec: 1 }),
  planClipExtension: () => ({ allowed: false, neededSec: 0, limitSec: 0 }),
  trimFittedClip: async () => {},
  holdLastFrameFittedClip: async () => {},
}))

let scratchDir: string
let part0Path: string
let part1Path: string

function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.getAssetsDir = () => scratchDir
  g.getVideosDir = () => scratchDir
  g.ensureDir = async () => {}
  g.logAgent = async () => {}
  g.prisma = {
    videoShot: {
      findMany: async () => h.shotRows,
      update: async () => ({}),
    },
    videoAsset: {
      findMany: async () => h.assetRows,
      findFirst: async () => null,
      create: async () => ({}),
      update: async () => ({}),
    },
  }
}

/** Кадры нарезаны ПО ЧАСТЯМ — ровно так их отдаёт `buildShotGrid`. */
const BOUNDS = [79.57, 81.48, 83.39, 85.3, 87.18, 89.06, 90.93]

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "cf-shot-parts-"))
  part0Path = join(scratchDir, "scene_9_lipsync.mp4")
  part1Path = join(scratchDir, "scene_9_part1_lipsync.mp4")
  await writeFile(part0Path, "часть 1")
  await writeFile(part1Path, "часть 2")
  for (let index = 0; index < BOUNDS.length - 1; index += 1) {
    await writeFile(join(scratchDir, `bg_${index}.png`), "заглушка фона")
  }
})

afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true }).catch(() => {})
})

function snapshotWithParts(parts: Array<{ index: number, startSec: number, endSec: number, outputPath: string | null }>) {
  return {
    scenes: [{
      sceneIndex: 8,
      sceneOrder: 9,
      outputPath: parts.find(part => part.outputPath)?.outputPath ?? null,
      reuseKey: "key-scene",
      durationSec: 5,
      parts: parts.map(part => ({ ...part, reuseKey: `key-${part.index}`, audioPath: null, durationSec: 5 })),
    }],
  }
}

beforeEach(() => {
  h.measuredByPath.clear()
  h.compositions.length = 0
  h.lipSyncSnapshot = snapshotWithParts([
    { index: 0, startSec: SCENE_START, endSec: SCENE_CUT, outputPath: part0Path },
    { index: 1, startSec: SCENE_CUT, endSec: SCENE_END, outputPath: part1Path },
  ])
  // Провайдер отдал ровно заказанные длины частей — приведение не нужно.
  h.measuredByPath.set(part0Path, SCENE_CUT - SCENE_START)
  h.measuredByPath.set(part1Path, SCENE_END - SCENE_CUT)
  h.shotRows = BOUNDS.slice(0, -1).map((startSec, index) => ({
    id: 100 + index, videoId: 1, order: index, startSec, endSec: BOUNDS[index + 1]!,
    sceneOrder: 9, foreground: "presenter", background: "image", pipEnabled: false,
    status: "planned", assetPath: null,
  }))
  h.assetRows = BOUNDS.slice(0, -1).map((_, index) => ({
    order: index, filePath: join(scratchDir, `bg_${index}.png`), contentType: "image/png",
  }))
  for (let index = 0; index < BOUNDS.length - 1; index += 1) {
    h.measuredByPath.set(join(scratchDir, `shot_${index}_composed.mp4`), BOUNDS[index + 1]! - BOUNDS[index]!)
  }
})

async function loadSteps() {
  installGlobals()
  return await import("../../../server/utils/video-pipeline-steps")
}

const SCENES = [{ order: 9, startSec: SCENE_START, endSec: SCENE_END, words: [] }]

describe("кадры разбитой реплики берут картинку из своей части", () => {
  it("кадры первой части идут из её файла, кадры второй — из своего, смещение считается от начала ЧАСТИ", async () => {
    const { composeVideoShots } = await loadSteps()
    const { DEFAULT_EDIT_PROFILE } = await import("../../../server/utils/edit-plan/profile")

    await composeVideoShots(1, { id: 7 }, SCENES, DEFAULT_EDIT_PROFILE, "portrait")

    expect(h.compositions).toHaveLength(BOUNDS.length - 1)
    for (const composition of h.compositions) expect(composition.kind).toBe("presenter_full")

    // Кадры 0-2 внутри первой части.
    for (const index of [0, 1, 2]) {
      expect(String(h.compositions[index]!.presenterPath), `кадр ${index}`).toBe(part0Path)
    }
    // Кадры 3-5 — во второй, и смещение у первого из них НУЛЕВОЕ: часть
    // начинается ровно там же, где кадр. Считай смещение от начала СЦЕНЫ, тут
    // было бы 5.73с — за концом файла части.
    for (const index of [3, 4, 5]) {
      expect(String(h.compositions[index]!.presenterPath), `кадр ${index}`).toBe(part1Path)
    }
    expect(Number(h.compositions[3]!.offsetSec)).toBeCloseTo(0, 3)
    expect(Number(h.compositions[4]!.offsetSec)).toBeCloseTo(BOUNDS[4]! - SCENE_CUT, 1)
  })

  it("вторая часть не синхронизировалась — её кадры уходят на фон, первая работает как прежде", async () => {
    // Частичный успех — штатная деградация: показываем то, что вышло.
    h.lipSyncSnapshot = snapshotWithParts([
      { index: 0, startSec: SCENE_START, endSec: SCENE_CUT, outputPath: part0Path },
      { index: 1, startSec: SCENE_CUT, endSec: SCENE_END, outputPath: null },
    ])

    const { composeVideoShots } = await loadSteps()
    const { DEFAULT_EDIT_PROFILE } = await import("../../../server/utils/edit-plan/profile")

    await composeVideoShots(1, { id: 7 }, SCENES, DEFAULT_EDIT_PROFILE, "portrait")

    for (const index of [0, 1, 2]) {
      expect(h.compositions[index]!.kind, `кадр ${index}`).toBe("presenter_full")
      expect(String(h.compositions[index]!.presenterPath)).toBe(part0Path)
    }
    for (const index of [3, 4, 5]) {
      expect(h.compositions[index]!.kind, `кадр ${index}`).toBe("background_full")
    }
  })

  it("снапшот без списка частей читается как раньше — один клип на всю сцену", async () => {
    // Обратная совместимость: снапшот прошлых версий поля `parts` не знает.
    h.lipSyncSnapshot = {
      scenes: [{ sceneIndex: 8, sceneOrder: 9, outputPath: part0Path, reuseKey: "key", durationSec: 5 }],
    }
    h.measuredByPath.set(part0Path, SCENE_END - SCENE_START)

    const { composeVideoShots } = await loadSteps()
    const { DEFAULT_EDIT_PROFILE } = await import("../../../server/utils/edit-plan/profile")

    await composeVideoShots(1, { id: 7 }, SCENES, DEFAULT_EDIT_PROFILE, "portrait")

    expect(h.compositions).toHaveLength(BOUNDS.length - 1)
    for (const composition of h.compositions) {
      expect(composition.kind).toBe("presenter_full")
      expect(String(composition.presenterPath)).toBe(part0Path)
    }
    // Смещение — от начала СЦЕНЫ, как и было до дробления.
    expect(Number(h.compositions[3]!.offsetSec)).toBeCloseTo(SCENE_CUT - SCENE_START, 1)
  })
})

describe("pickPresenterPartForShot", () => {
  const parts = [
    { path: "p0" as never, liveSec: 5.73, startSec: 79.57, endSec: 85.3 },
    { path: "p1" as never, liveSec: 5.63, startSec: 85.3, endSec: 90.93 },
  ]

  it("одна часть отдаётся без выбора — поведение до дробления", async () => {
    const { pickPresenterPartForShot } = await loadSteps()
    expect(pickPresenterPartForShot([parts[0]!], 0, 1000)).toBe(parts[0])
  })

  it("пусто — ведущего нет", async () => {
    const { pickPresenterPartForShot } = await loadSteps()
    expect(pickPresenterPartForShot([], 0, 1)).toBeNull()
    expect(pickPresenterPartForShot(null, 0, 1)).toBeNull()
  })

  it("кадр, переехавший границу частей, получает ту, где его БОЛЬШЕ", async () => {
    const { pickPresenterPartForShot } = await loadSteps()
    // 84.0-85.6: 1.3с в первой части против 0.3с во второй.
    expect(pickPresenterPartForShot(parts, 84.0, 85.6)).toBe(parts[0])
    // 85.0-87.0: 0.3с в первой против 1.7с во второй.
    expect(pickPresenterPartForShot(parts, 85.0, 87.0)).toBe(parts[1])
  })
})
