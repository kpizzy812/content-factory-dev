/**
 * Проводка ЖИВОЙ длины клипа ведущей от снапшота lip-sync до композиции кадра
 * (второй эшелон защиты от замороженного лица, дефект ролика 30).
 *
 * `fitPresenterClipsToScenes` приводит клип к длине СЦЕНЫ, добивая недостачу
 * удержанием последнего кадра, — то есть длина ФАЙЛА и длина живого материала
 * это разные величины. Без этого теста мутация «отдавать длину файла вместо
 * живой» была бы зелёной на всей сьюте, а на экране дала бы ровно тот же
 * застывший липсинк: `planShotComposition` получил бы `presenterLiveSec`,
 * равный длине сцены, и никогда не сработал бы.
 *
 * Числа настоящие: сцена 9 ролика 30 идёт 79.57-90.93 (11.36с), клип lip-sync
 * из снапшота шага — 9.90с. Приём мокирования — тот же, что у
 * `shot-composed-duration-check.spec.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCENE_START = 79.57
const SCENE_END = 90.93
/** Что реально отдала модель на заказ 10.00с. */
const LIVE_SEC = 9.9

const h = vi.hoisted(() => ({
  measuredByPath: new Map<string, number>(),
  shotRows: [] as Array<Record<string, unknown>>,
  assetRows: [] as Array<Record<string, unknown>>,
  compositions: [] as Array<Record<string, unknown>>,
  holdCalls: [] as Array<{ input: string, output: string, extraSec: number }>,
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
  holdLastFrameFittedClip: async (input: string, output: string, extraSec: number) => {
    h.holdCalls.push({ input, output, extraSec })
  },
}))

let scratchDir: string
let lipSyncPath: string

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

/** Кадры сцены 9 по 1.62с — та же нарезка, что была в реальном плане. */
const BOUNDS = [79.57, 81.19, 82.81, 84.43, 86.05, 87.67, 89.29, 90.93]

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "cf-shot-live-"))
  lipSyncPath = join(scratchDir, "scene_9_lipsync.mp4")
  await writeFile(lipSyncPath, "заглушка клипа lip-sync")
  for (let index = 0; index < BOUNDS.length - 1; index += 1) {
    await writeFile(join(scratchDir, `bg_${index}.png`), "заглушка фона")
  }
})

afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true }).catch(() => {})
})

beforeEach(() => {
  h.measuredByPath.clear()
  h.compositions.length = 0
  h.holdCalls.length = 0
  h.lipSyncSnapshot = { scenes: [{ sceneIndex: 8, sceneOrder: 9, outputPath: lipSyncPath, reuseKey: null, durationSec: LIVE_SEC }] }
  // Исходный клип короче сцены — ровно как отдал провайдер.
  h.measuredByPath.set(lipSyncPath, LIVE_SEC)
  // Приведённый клип уже на диске нет: `defaultShotFileExists` вернёт false,
  // и приведение пойдёт через `holdLastFrameFittedClip`.
  h.shotRows = BOUNDS.slice(0, -1).map((startSec, index) => ({
    id: 100 + index, videoId: 1, order: index, startSec, endSec: BOUNDS[index + 1]!,
    sceneOrder: 9, foreground: "presenter", background: "image", pipEnabled: false,
    status: "planned", assetPath: null,
  }))
  h.assetRows = BOUNDS.slice(0, -1).map((_, index) => ({
    order: index, filePath: join(scratchDir, `bg_${index}.png`), contentType: "image/png",
  }))
  // Собранные кадры «намерены» ровно в свой интервал: сверка Important 3 не
  // должна мешать смотреть на выбор ветки композиции.
  for (let index = 0; index < BOUNDS.length - 1; index += 1) {
    h.measuredByPath.set(join(scratchDir, `shot_${index}_composed.mp4`), BOUNDS[index + 1]! - BOUNDS[index]!)
  }
})

async function loadSteps() {
  installGlobals()
  return await import("../../../server/utils/video-pipeline-steps")
}

const SCENES = [{ order: 9, startSec: SCENE_START, endSec: SCENE_END, words: [] }]

describe("живая длина клипа ведущей доезжает до композиции", () => {
  it("кадр в удержанном хвосте собирается ФОНОМ, а кадры внутри живого — ведущим", async () => {
    const { composeVideoShots } = await loadSteps()
    const { DEFAULT_EDIT_PROFILE } = await import("../../../server/utils/edit-plan/profile")

    const result = await composeVideoShots(1, { id: 7 }, SCENES, DEFAULT_EDIT_PROFILE, "portrait")

    expect(result).not.toBeNull()
    expect(h.compositions).toHaveLength(BOUNDS.length - 1)

    // Приведение клипа к длине сцены реально произошло удержанием кадра —
    // то есть замороженный хвост в файле есть, и он длиной 11.36 − 9.90.
    expect(h.holdCalls).toHaveLength(1)
    expect(h.holdCalls[0]!.extraSec).toBeCloseTo(SCENE_END - SCENE_START - LIVE_SEC, 1)

    // Кадры 0..5 целиком внутри живых 9.90с от начала сцены (последний из них
    // кончается на 9.72) — ведущий на месте.
    for (const index of [0, 1, 2, 3, 4, 5]) {
      expect(h.compositions[index]!.kind, `кадр ${index}`).toBe("presenter_full")
    }
    // Кадр 6 (89.29-90.93) — смещение 9.72 при живых 9.90: почти весь кадр
    // пришёлся бы на застывшее лицо. Показываем фон.
    expect(h.compositions[6]!.kind).toBe("background_full")
    expect(String(h.compositions[6]!.backgroundPath)).toContain("bg_6.png")
  })

  it("своего фона у кадра нет — берётся БЛИЖАЙШИЙ, а не чёрный экран", async () => {
    // Кадру ведущего фон обычно и не планируется (`background: "none"`), и
    // именно на таком кадре второй эшелон обязан хоть что-то показать. Здесь
    // ассет есть у кадров 0-5 и нет у кадра 6 — того самого, что уезжает в
    // удержанный хвост.
    h.assetRows = h.assetRows.filter(row => row.order !== 6)

    const { composeVideoShots } = await loadSteps()
    const { DEFAULT_EDIT_PROFILE } = await import("../../../server/utils/edit-plan/profile")

    await composeVideoShots(1, { id: 7 }, SCENES, DEFAULT_EDIT_PROFILE, "portrait")

    expect(h.compositions).toHaveLength(BOUNDS.length - 1)
    expect(h.compositions[6]!.kind).toBe("background_full")
    // Ближайший по номеру — фон кадра 5.
    expect(String(h.compositions[6]!.backgroundPath)).toContain("bg_5.png")
  })

  it("клип не короче сцены — ни один кадр не подменяется фоном", async () => {
    // Контроль на ложное срабатывание: тот же план, но провайдер отдал ровно
    // столько, сколько нужно. Без этого теста мутация «всегда считать ведущего
    // замёрзшим» осталась бы незамеченной.
    h.measuredByPath.set(lipSyncPath, SCENE_END - SCENE_START)
    const { composeVideoShots } = await loadSteps()
    const { DEFAULT_EDIT_PROFILE } = await import("../../../server/utils/edit-plan/profile")

    await composeVideoShots(1, { id: 7 }, SCENES, DEFAULT_EDIT_PROFILE, "portrait")

    for (const composition of h.compositions) expect(composition.kind).toBe("presenter_full")
  })
})
