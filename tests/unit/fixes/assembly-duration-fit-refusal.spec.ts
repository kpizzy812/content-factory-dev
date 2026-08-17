/**
 * Регрессия (preflight audio-first, задача 5): ролик, которому подгон длины
 * клипов под звуковой трек НЕ состоялся, не имеет права дойти до «готов».
 *
 * Деградированное выравнивание схлопывает соседние сцены в одну точку времени,
 * `planAlignedClipTargets` честно отказывается считать бакеты, и подгон
 * выключается ЦЕЛИКОМ для ролика. Раньше единственным следом этого была строка
 * в логе шага: сборка шла дальше, ролик заливался в хранилище и получал статус
 * «готов», хотя его картинка заведомо длиннее звука. Тот же класс брака, ради
 * которого принят ruling «транскрипция обязательна» (spec §4.1), и та же
 * реакция, что у §10 на упавшую транскрипцию: «шаг падает честно, ролик не
 * помечается готовым».
 *
 * Штатное ЧАСТИЧНОЕ схождение (§10: границы сцены делятся пропорционально,
 * WARN в лог) сюда не относится и обязано собираться как прежде — оно
 * возвращает applied:true.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SubtitlePlacement } from "~~/shared/types/story"
import type { AlignedScene } from "~~/server/utils/transcription/align"
import type { ClipDurationFitSummary } from "~~/server/utils/render"

const h = vi.hoisted(() => ({
  step: { id: 12, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  updates: [] as Record<string, unknown>[],
  assembleCalls: [] as Array<Record<string, unknown>>,
  durationFit: undefined as ClipDurationFitSummary | undefined,
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
  g.assembleVideo = async (opts: Record<string, unknown>) => {
    h.assembleCalls.push(opts)
    return { filePath: "final.mp4", duration: 30, durationFit: h.durationFit }
  }
  g.prisma = {
    videoAsset: { findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
  }
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

/** Сцены выравнивания в том виде, в каком их отдаёт шаг транскрипции. */
function alignedScenes(): AlignedScene[] {
  return [
    { order: 1, startSec: 0.2, endSec: 4.0, words: [] },
    { order: 2, startSec: 4.5, endSec: 8.0, words: [] },
    { order: 3, startSec: 8.5, endSec: 11.8, words: [] },
  ]
}

const CLIPS = ["c0.mp4", "c1.mp4", "c2.mp4"]

/** extras маршрута «монтаж от звука»: выравнивание доехало, длина трека измерена. */
function audioFirstExtras(): Record<string, unknown> {
  return { clipSceneOrders: [1, 2, 3], alignedScenes: alignedScenes(), voiceoverDurationSec: 12 }
}

async function loadSteps() {
  installGlobals()
  return await import("../../../server/utils/video-pipeline-steps")
}

function stepFailed(): boolean {
  return h.updates.some(patch => patch.status === "failed")
}

function stepCompleted(): boolean {
  return h.updates.some(patch => patch.status === "completed")
}

beforeEach(() => {
  h.step = { id: 12, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.updates.length = 0
  h.assembleCalls.length = 0
  h.durationFit = undefined
})

describe("runAssembly: отказ подгона длины под трек роняет сборку честно", () => {
  it("схлопнутое выравнивание (applied:false) — шаг падает, а не отдаёт готовый ролик", async () => {
    const steps = await loadSteps()
    h.durationFit = {
      applied: false,
      reason: "нулевой или отрицательный интервал трека между анкорами (3.000с..3.000с, позиции 1..1)",
      trimmedCount: 0,
      heldCount: 0,
      totalDeltaSec: 0,
    }

    await expect(
      steps.runAssembly(31, CLIPS, null, true, "", "", "portrait", plan(), audioFirstExtras()),
    ).rejects.toThrow(/подгон/i)

    expect(stepFailed()).toBe(true)
    expect(stepCompleted()).toBe(false)
    // Причина отказа обязана доехать до оператора, а не остаться внутри render.ts.
    expect(h.logs.some(l => l.includes("нулевой или отрицательный интервал"))).toBe(true)
  })

  it("render не сообщил итог подгона вовсе — тоже отказ, а не молчаливое «готово»", async () => {
    const steps = await loadSteps()
    h.durationFit = undefined

    await expect(
      steps.runAssembly(31, CLIPS, null, true, "", "", "portrait", plan(), audioFirstExtras()),
    ).rejects.toThrow(/подгон/i)

    expect(stepFailed()).toBe(true)
  })

  it("выравнивание доехало, а длина трека — нет: отказ, не доходя до рендера", async () => {
    const steps = await loadSteps()

    await expect(
      steps.runAssembly(31, CLIPS, null, true, "", "", "portrait", plan(), {
        clipSceneOrders: [1, 2, 3],
        alignedScenes: alignedScenes(),
        // voiceoverDurationSec отсутствует — clipTrackAlignment не построить,
        // подгон не запустится вовсе, и раньше это молчало.
      }),
    ).rejects.toThrow(/подгон/i)

    expect(h.assembleCalls).toHaveLength(0)
    expect(stepFailed()).toBe(true)
  })

  it("подгон состоялся — сборка идёт до конца (частичное схождение §10 не ломается)", async () => {
    const steps = await loadSteps()
    // §10: «выравнивание сошлось частично → границы сцены делятся
    // пропорционально, WARN в лог шага». На этом пути plan.ok === true и
    // summary.applied === true — сборка обязана дойти до конца.
    h.durationFit = { applied: true, trimmedCount: 2, heldCount: 1, totalDeltaSec: 1.4 }

    const result = await steps.runAssembly(31, CLIPS, null, true, "", "", "portrait", plan(), audioFirstExtras())

    expect(result.filePath).toBe("final.mp4")
    expect(stepCompleted()).toBe(true)
    expect(stepFailed()).toBe(false)
  })

  it("старый маршрут без выравнивания собирается как прежде — отсутствие подгона ему не отказ", async () => {
    const steps = await loadSteps()
    h.durationFit = undefined // старый маршрут подгон не заказывает вовсе

    const result = await steps.runAssembly(31, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
    })

    expect(result.duration).toBe(30)
    expect(stepCompleted()).toBe(true)
    expect(stepFailed()).toBe(false)
  })
})
