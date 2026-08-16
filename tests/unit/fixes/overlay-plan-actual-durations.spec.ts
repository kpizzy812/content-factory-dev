/**
 * Регрессия: слой инфографики живёт на том же таймлайне, что и остальной ролик.
 *
 * Ролик 24: сборка выдала 82.7 с, а файл с наложенной инфографикой — ровно 90.0,
 * то есть девять сцен по плановые десять секунд. Композиция Remotion строилась по
 * ПЛАНУ, а не по фактическому видео: в конце ролика оставалось 7.4 секунды
 * немого хвоста, и плашки со статистикой вставали не на свои сцены.
 *
 * Это тот же разъезд «план против факта», что и у клипов с озвучкой, только на
 * последнем шаге. Длину композиции задаёт готовый файл, а стартовые времена
 * плашек — фактические длительности клипов.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SubtitlePlacement } from "~~/shared/types/story"

const h = vi.hoisted(() => ({
  step: { id: 12, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  /** Длительности «файлов» клипов: план врёт про 10 секунд у каждой сцены. */
  durationByPath: new Map<string, number>(),
  overlayRequests: [] as Array<{
    inputPath: string
    plan: { overlays: Array<{ sceneOrder: number; startSec: number }>; totalDurationSec: number }
  }>,
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async () => undefined,
  appendStepLog: async (_id: number, line: string) => { h.logs.push(line) },
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/render", () => ({
  // Нормализация под concat: в тесте файлов нет, отдаём пути как есть.
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeSceneClipDurations: async (paths: string[]) =>
    paths.map(p => (p.trim().length === 0 ? null : h.durationByPath.get(p) ?? 5)),
  probeMediaDuration: async (p: string) => h.durationByPath.get(p) ?? null,
  probeClipDurations: async (paths: string[]) => paths.map(p => h.durationByPath.get(p) ?? 5),
  adjustAudioTempo: async () => ({ outputPath: "x", durationSec: 1 }),
  trimAudio: async () => ({ outputPath: "x", durationSec: 1 }),
  extendVideoClip: async () => ({ outputPath: "x", durationSec: 1 }),
  planClipExtension: () => ({ allowed: false, neededSec: 0, limitSec: 0 }),
}))

vi.mock("../../../server/utils/agents/subtitle-keyword-agent", () => ({
  runSubtitleKeywordAgent: async () => ({ segments: [] }),
}))
vi.mock("../../../server/utils/remotion/render", () => ({
  renderRemotionOverlays: async (req: (typeof h.overlayRequests)[number]) => {
    h.overlayRequests.push(req)
    return { status: "skipped", reason: "тест" }
  },
}))
vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: async (_p: string, storageKey: string) => ({ storageKey, storageProvider: "local" }),
}))
vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: () => "/api/files/final.mp4",
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: async () => undefined }))

function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.getVideosDir = () => tmpdir()
  g.getAssetsDir = () => tmpdir()
  g.ensureDir = async () => {}
  g.safeUnlink = async () => {}
  g.logAgent = async () => {}
  g.assembleVideo = async () => ({ filePath: "final.mp4", duration: 30 })
  g.prisma = {
    videoAsset: { findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
  }
}

const BOTTOM: SubtitlePlacement = { position: "bottom", alignment: "center", avoidZones: [] }

/** Три сцены: план обещает по 10 секунд, фактические клипы короче. */
function plan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [
      { order: 1, durationSec: 10, subtitleCopy: "Сначала без цифр", subtitlePlacement: BOTTOM, spokenLine: null },
      { order: 2, durationSec: 10, subtitleCopy: "Нитратов больше на 20%", subtitlePlacement: BOTTOM, spokenLine: null },
      { order: 3, durationSec: 10, subtitleCopy: "И ещё 40% сверху", subtitlePlacement: BOTTOM, spokenLine: null },
    ],
    subtitleStyle: null,
  } as unknown as StoryDrivenVideoPlan
}

async function loadSteps() {
  installGlobals()
  return await import("../../../server/utils/video-pipeline-steps")
}

beforeEach(() => {
  h.step = { id: 12, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.overlayRequests.length = 0
  h.durationByPath.clear()
  h.durationByPath.set("c0.mp4", 6)
  h.durationByPath.set("c1.mp4", 7)
  h.durationByPath.set("c2.mp4", 8)
})

describe("runAssembly: инфографика считается по фактическим клипам", () => {
  it("плашка встаёт на старт СВОЕЙ сцены, а не на плановый", async () => {
    const steps = await loadSteps()

    await steps.runAssembly(24, ["c0.mp4", "c1.mp4", "c2.mp4"], null, true, "", "", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
    })

    const overlays = h.overlayRequests[0]!.plan.overlays
    // Сцена 2 начинается на 6-й секунде (длина первого клипа), а не на 10-й;
    // плашка появляется через секунду после старта сцены.
    expect(overlays.map(o => ({ scene: o.sceneOrder, start: o.startSec }))).toEqual([
      { scene: 2, start: 7 },
      { scene: 3, start: 14 },
    ])
  })

  it("длина композиции равна фактическому ролику, а не сумме плановых сцен", async () => {
    const steps = await loadSteps()

    await steps.runAssembly(24, ["c0.mp4", "c1.mp4", "c2.mp4"], null, true, "", "", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
    })

    // 6 + 7 + 8 = 21, а не 30: иначе в конце ролика остаётся немой хвост.
    expect(h.overlayRequests[0]!.plan.totalDurationSec).toBe(21)
  })

  it("сцена без клипа не занимает места в таймлайне инфографики", async () => {
    const steps = await loadSteps()

    await steps.runAssembly(24, ["c0.mp4", "", "c2.mp4"], null, true, "", "", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
    })

    const req = h.overlayRequests[0]!
    expect(req.plan.totalDurationSec).toBe(14)
    // Сцены 2 в ролике нет — её плашки быть не должно, а сцена 3 идёт сразу за первой.
    expect(req.plan.overlays.map(o => ({ scene: o.sceneOrder, start: o.startSec }))).toEqual([
      { scene: 3, start: 7 },
    ])
  })
})
