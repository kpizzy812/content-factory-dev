/**
 * Регрессия: сборка получает список клипов ПО СЦЕНАМ и обязана уплотнить его
 * ровно один раз — перед склейкой, вместе с индексами субтитров.
 *
 * До 15.08.2026 список приходил плотным, и «индекс сцены» с «позицией в склейке»
 * совпадали случайно. Теперь у сцены, которую в ролике не будет (клип не сделали
 * и lip-sync не закрыл), ячейка пуста: пустая строка в concat-листе уронила бы
 * ffmpeg, а субтитр сцены, стоящей ПОСЛЕ дыры, уехал бы на клип соседа.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SubtitlePlacement } from "~~/shared/types/story"

const h = vi.hoisted(() => ({
  step: { id: 11, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  inputSnapshots: [] as Record<string, unknown>[],
  assembleCalls: [] as Array<{
    clips: string[]
    sceneSubtitles?: Array<{ sceneIndex: number; text: string }>
  }>,
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async (_id: number, patch: Record<string, unknown>) => {
    if (patch.inputSnapshot) h.inputSnapshots.push(patch.inputSnapshot as Record<string, unknown>)
  },
  appendStepLog: async (_id: number, line: string) => { h.logs.push(line) },
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/render", () => ({
  // Нормализация под concat: в тесте файлов нет, отдаём пути как есть.
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeSceneClipDurations: async (paths: string[]) => paths.map(p => (p ? 5 : null)),
  probeClipDurations: async (paths: string[]) => paths.map(() => 5),
  adjustAudioTempo: async () => ({ outputPath: "x", durationSec: 1 }),
  trimAudio: async () => ({ outputPath: "x", durationSec: 1 }),
  extendVideoClip: async () => ({ outputPath: "x", durationSec: 1 }),
  planClipExtension: () => ({ allowed: false, neededSec: 0, limitSec: 0 }),
}))

vi.mock("../../../server/utils/agents/subtitle-keyword-agent", () => ({
  runSubtitleKeywordAgent: async () => ({ segments: [] }),
}))
vi.mock("../../../server/utils/remotion/render", () => ({
  renderRemotionOverlays: async () => ({ status: "skipped", reason: "тест" }),
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
  g.assembleVideo = async (opts: (typeof h.assembleCalls)[number]) => {
    h.assembleCalls.push(opts)
    return { filePath: "final.mp4", duration: 30 }
  }
  g.prisma = {
    videoAsset: { findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
  }
}

const BOTTOM: SubtitlePlacement = { position: "bottom", alignment: "center", avoidZones: [] }

function plan(scenes: Array<{ order: number; text: string }>): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: scenes.map(s => ({
      order: s.order,
      durationSec: 5,
      subtitleCopy: s.text,
      subtitlePlacement: BOTTOM,
      spokenLine: null,
      voiceoverLine: null,
    })),
    subtitleStyle: null,
  } as unknown as StoryDrivenVideoPlan
}

async function loadSteps() {
  installGlobals()
  return await import("../../../server/utils/video-pipeline-steps")
}

beforeEach(() => {
  h.step = { id: 11, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.inputSnapshots.length = 0
  h.assembleCalls.length = 0
})

describe("runAssembly: пустые ячейки сцен выбрасываются перед склейкой", () => {
  it("в concat уходят только реальные клипы", async () => {
    const steps = await loadSteps()

    await steps.runAssembly(
      23, ["c0.mp4", "", "c2.mp4"], null, true, "", "", "portrait",
      plan([{ order: 1, text: "Первая" }, { order: 2, text: "Вторая" }, { order: 3, text: "Третья" }]),
      { clipSceneOrders: [1, 2, 3] },
    )

    expect(h.assembleCalls[0]!.clips).toEqual(["c0.mp4", "c2.mp4"])
  })

  it("субтитр сцены после дыры едет на СВОЙ клип, а не на соседний", async () => {
    const steps = await loadSteps()

    await steps.runAssembly(
      23, ["c0.mp4", "", "c2.mp4"], null, true, "", "", "portrait",
      plan([{ order: 1, text: "Первая" }, { order: 2, text: "Вторая" }, { order: 3, text: "Третья" }]),
      { clipSceneOrders: [1, 2, 3] },
    )

    // Сцены 2 в ролике нет — её субтитр отброшен. Сцена 3 стала вторым клипом.
    expect(h.assembleCalls[0]!.sceneSubtitles!.map(s => ({ text: s.text, sceneIndex: s.sceneIndex }))).toEqual([
      { text: "Первая", sceneIndex: 0 },
      { text: "Третья", sceneIndex: 1 },
    ])
  })

  it("сцены, выпавшие из сборки, названы в логе шага", async () => {
    const steps = await loadSteps()

    await steps.runAssembly(
      23, ["c0.mp4", "", "c2.mp4"], null, true, "", "", "portrait",
      plan([{ order: 1, text: "Первая" }, { order: 2, text: "Вторая" }, { order: 3, text: "Третья" }]),
      { clipSceneOrders: [1, 2, 3] },
    )

    expect(h.logs.some(l => l.includes("без клипа") || l.includes("не попад"))).toBe(true)
  })

  it("сплошной список собирается ровно как раньше", async () => {
    const steps = await loadSteps()

    await steps.runAssembly(
      23, ["c0.mp4", "c1.mp4"], null, true, "", "", "portrait",
      plan([{ order: 1, text: "Первая" }, { order: 2, text: "Вторая" }]),
      { clipSceneOrders: [1, 2] },
    )

    expect(h.assembleCalls[0]!.clips).toEqual(["c0.mp4", "c1.mp4"])
    expect(h.assembleCalls[0]!.sceneSubtitles!.map(s => s.sceneIndex)).toEqual([0, 1])
  })
})
