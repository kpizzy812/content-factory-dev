/**
 * Task 6 («Сборка по кадрам»): инертность старого маршрута — доказана тестом,
 * а не заявлена.
 *
 * `runAssembly` теперь строит кадровый таймлайн (`shotTimeline`) внутри ветки
 * `extras.shotRouteActive`, и по пути гасит клип-позиционные вычисления
 * (`sceneSubtitles`, `clipTrackAlignment`, keyword pre-pass, Remotion-плашки),
 * которые раньше исполнялись безусловно. Три сценария обязаны остаться
 * ПОБАЙТОВО прежними:
 *
 *  A. Флага `shotRouteActive` нет вовсе (старый вызывающий, ролик без
 *     EDIT_PIPELINE) — `prisma.video`/`prisma.videoShot` не мокаются вовсе
 *     в этом файле: случайный поход в БД внутри кадровой ветки уронил бы
 *     тест `TypeError`, а не тихо продолжил работать неверно.
 *  B. `shotRouteActive: false` явно — тот же результат, что и без поля
 *     вовсе (сравнение опций `assembleVideo` побайтово, `toEqual`).
 *  C. `shotRouteActive: true`, но `VideoShot` в БД нет (ролик с флагом, но
 *     без состоявшегося трека — `video-pipeline.ts` в этом случае
 *     `shotRouteActive` не проставляет, но `runAssembly` обязан остаться
 *     безопасным и в этом защитном случае) — `composeVideoShots` возвращает
 *     `null`, `shotTimeline` не строится, опции `assembleVideo` совпадают с
 *     сценарием A/B побайтово.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SubtitlePlacement } from "~~/shared/types/story"

const h = vi.hoisted(() => ({
  step: { id: 44, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  updates: [] as Record<string, unknown>[],
  assembleCalls: [] as Array<Record<string, unknown>>,
  extendVideoClipCalls: 0,
  videoShotRows: [] as Array<Record<string, unknown>>,
  videoRow: null as Record<string, unknown> | null,
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async (_id: number, patch: Record<string, unknown>) => { h.updates.push(patch) },
  appendStepLog: async (_id: number, line: string) => { h.logs.push(line) },
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/render", () => ({
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeSceneClipDurations: async (paths: string[]) => paths.map(p => (p ? 5 : null)),
  probeMediaDuration: async (path: string) => (path ? 5 : null),
  probeClipDurations: async (paths: string[]) => paths.map(() => 5),
  adjustAudioTempo: async () => ({ outputPath: "x", durationSec: 1 }),
  trimAudio: async () => ({ outputPath: "x", durationSec: 1 }),
  extendVideoClip: async () => { h.extendVideoClipCalls += 1; return { outputPath: "x", durationSec: 1 } },
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

function installGlobals(withShotDb: boolean) {
  const g = globalThis as Record<string, unknown>
  g.getVideosDir = () => tmpdir()
  g.getAssetsDir = () => tmpdir()
  g.ensureDir = async () => {}
  g.safeUnlink = async () => {}
  g.logAgent = async () => {}
  g.assembleVideo = async (opts: Record<string, unknown>) => {
    h.assembleCalls.push(opts)
    return { filePath: "final.mp4", duration: 30, durationFit: undefined }
  }
  const prisma: Record<string, unknown> = {
    videoAsset: { findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
  }
  // Сценарий A (флага нет вовсе) намеренно НЕ даёт `video`/`videoShot` вовсе:
  // случайный поход в БД внутри кадровой ветки должен уронить тест ошибкой,
  // а не тихо продолжить с undefined.
  if (withShotDb) {
    prisma.video = {
      findUnique: async () => h.videoRow,
    }
    prisma.videoShot = {
      findMany: async () => h.videoShotRows,
    }
  }
  g.prisma = prisma
}

const BOTTOM: SubtitlePlacement = { position: "bottom", alignment: "center", avoidZones: [] }

function plan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [1, 2, 3].map(order => ({
      order,
      durationSec: 5,
      subtitleCopy: `Сцена ${order}`,
      subtitlePlacement: BOTTOM,
      spokenLine: null,
      voiceoverLine: null,
    })),
    subtitleStyle: null,
  } as unknown as StoryDrivenVideoPlan
}

const CLIPS = ["c0.mp4", "c1.mp4", "c2.mp4"]

async function loadSteps(withShotDb: boolean) {
  installGlobals(withShotDb)
  return await import("../../../server/utils/video-pipeline-steps")
}

beforeEach(() => {
  h.step = { id: 44, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.updates.length = 0
  h.assembleCalls.length = 0
  h.extendVideoClipCalls = 0
  h.videoShotRows = []
  h.videoRow = null
})

describe("Task 6: инертность старого маршрута — доказана тестом", () => {
  it("A. shotRouteActive не передан — assembleVideo не получает shotTimeline, prisma кадров не тронута", async () => {
    const steps = await loadSteps(false)

    const result = await steps.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
    })

    expect(result.filePath).toBe("final.mp4")
    expect(h.assembleCalls).toHaveLength(1)
    expect(h.assembleCalls[0]!.shotTimeline).toBeUndefined()
    expect(h.assembleCalls[0]!.clips).toEqual(CLIPS)
  })

  it("B. shotRouteActive: false — результат ПОБАЙТОВО совпадает с отсутствием поля", async () => {
    const stepsWithout = await loadSteps(false)
    await stepsWithout.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
    })
    const withoutFlagCall = h.assembleCalls[0]

    h.assembleCalls.length = 0
    h.logs.length = 0
    h.updates.length = 0

    const stepsFalse = await loadSteps(false)
    await stepsFalse.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
      shotRouteActive: false,
    })
    const withFalseFlagCall = h.assembleCalls[0]

    expect(withFalseFlagCall).toEqual(withoutFlagCall)
  })

  it("C. shotRouteActive: true, но VideoShot в БД нет — сборка отказывается от кадрового таймлайна и идёт прежним путём", async () => {
    const stepsWithout = await loadSteps(false)
    await stepsWithout.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
    })
    const baseline = h.assembleCalls[0]

    h.assembleCalls.length = 0
    h.logs.length = 0
    h.updates.length = 0
    h.videoShotRows = [] // ролик БЕЗ единого кадра, несмотря на выставленный флаг
    h.videoRow = { editProfileId: null, editOverrides: null, editProfile: null, applicationId: null, voiceoverReconciliation: null }

    const stepsWithFlag = await loadSteps(true)
    const result = await stepsWithFlag.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
      shotRouteActive: true,
    })

    expect(result.filePath).toBe("final.mp4")
    expect(h.assembleCalls[0]).toEqual(baseline)
  })

  it("§8 — voiceoverReconciliation выключается ЯВНО на кадровом маршруте: лог называет причину, extendVideoClip не зовётся", async () => {
    h.videoShotRows = [] // компоновать нечего — но лог о политике обязан появиться ДО этого решения
    h.videoRow = { editProfileId: null, editOverrides: null, editProfile: null, applicationId: null, voiceoverReconciliation: "extend_scene" }

    const steps = await loadSteps(true)
    await steps.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
      shotRouteActive: true,
    })

    expect(h.logs.some(l => l.includes("voiceoverReconciliation") && l.includes("extend_scene") && l.includes("не")))
      .toBe(true)
    expect(h.extendVideoClipCalls).toBe(0)
  })

  it("нейтральная политика (не задана) — лог о voiceoverReconciliation не появляется", async () => {
    h.videoShotRows = []
    h.videoRow = { editProfileId: null, editOverrides: null, editProfile: null, applicationId: null, voiceoverReconciliation: null }

    const steps = await loadSteps(true)
    await steps.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
      shotRouteActive: true,
    })

    expect(h.logs.some(l => l.includes("voiceoverReconciliation"))).toBe(false)
  })
})
