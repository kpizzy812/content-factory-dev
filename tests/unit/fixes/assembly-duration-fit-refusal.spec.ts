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
  keywordAgentCalls: 0,
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
  // Строгий замер: ворота подгона считают длины ИМ, тем же, что и решающий
  // `fitClipsToTrack`, — неизмеримый файл обязан дать null, а не подставное «5».
  probeMediaDuration: async (path: string) => (path ? 5 : null),
  probeClipDurations: async (paths: string[]) => paths.map(() => 5),
  adjustAudioTempo: async () => ({ outputPath: "x", durationSec: 1 }),
  trimAudio: async () => ({ outputPath: "x", durationSec: 1 }),
  extendVideoClip: async () => ({ outputPath: "x", durationSec: 1 }),
  planClipExtension: () => ({ allowed: false, neededSec: 0, limitSec: 0 }),
}))

vi.mock("../../../server/utils/agents/subtitle-keyword-agent", () => ({
  // Платный вызов Anthropic с кэшем только в памяти процесса: на обречённом
  // ролике он оплачивался бы заново при каждом перезапуске.
  runSubtitleKeywordAgent: async () => {
    h.keywordAgentCalls += 1
    return { segments: [] }
  },
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

/**
 * Вырожденное выравнивание: сцены 2 и 3 схлопнуты в одну точку трека, интервал
 * между анкорами нулевой (`align.ts` даёт это уже на ВТОРОЙ подряд
 * несопоставленной сцене — span=0 при интерполяции).
 */
function collapsedAlignedScenes(): AlignedScene[] {
  return [
    { order: 1, startSec: 1.0, endSec: 3.0, words: [] },
    { order: 2, startSec: 3.0, endSec: 3.0, words: [] },
    { order: 3, startSec: 3.0, endSec: 3.0, words: [] },
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
  h.keywordAgentCalls = 0
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

  // Ревью: ролик, целиком снятый ведущей, шаг промптов пропускает
  // (`video-pipeline.ts:621` → `skipPromptGenerationStep`), поэтому scenePrompts
  // у него нет и `clipSceneOrders` в сборку приходит `undefined`. Карта позиций
  // пуста НЕ потому, что выравнивание выродилось, а по устройству ролика:
  // чужих клипов, на которые могло бы уехать сопоставление, не существует —
  // клип каждой сцены сделал lip-sync (тот же довод, что у `presenterOnlyVideo`,
  // `lip-sync-runner.ts:247-262`). Без различения этих двух случаев падал бы
  // КАЖДЫЙ ролик ведущей — флагманский сценарий маршрута.
  it("ролик ведущей (порядок нарезки не передан) собирается: позиции берутся из плана", async () => {
    const steps = await loadSteps()
    h.durationFit = { applied: true, trimmedCount: 3, heldCount: 0, totalDeltaSec: 0.9 }

    const result = await steps.runAssembly(31, CLIPS, null, true, "", "", "portrait", plan(), {
      // clipSceneOrders нет вовсе — ровно то, что приходит от presenterOnly-ролика.
      alignedScenes: alignedScenes(),
      voiceoverDurationSec: 12,
    })

    expect(result.filePath).toBe("final.mp4")
    expect(stepCompleted()).toBe(true)
    expect(stepFailed()).toBe(false)
    // Подгон реально заказан, а не тихо пропущен: карта позиций доехала до render.
    expect(h.assembleCalls[0]!.clipTrackAlignment).toBeDefined()
    // Допущение о порядке названо вслух — оператор не должен догадываться.
    expect(h.logs.some(l => l.includes("Порядок нарезки клипов не передан") && l.includes("подгон"))).toBe(true)
  })

  it("у ролика ведущей вырожденное выравнивание по-прежнему роняет сборку", async () => {
    const steps = await loadSteps()

    await expect(
      steps.runAssembly(31, CLIPS, null, true, "", "", "portrait", plan(), {
        alignedScenes: collapsedAlignedScenes(),
        voiceoverDurationSec: 8,
      }),
    ).rejects.toThrow(/подгон/i)

    expect(stepFailed()).toBe(true)
    expect(h.logs.some(l => l.includes("нулевой или отрицательный интервал"))).toBe(true)
  })

  it("вырожденное выравнивание останавливает сборку ДО рендера и ДО платного предпрохода", async () => {
    const steps = await loadSteps()

    await expect(
      steps.runAssembly(31, CLIPS, null, true, "", "", "portrait", plan(), {
        ...audioFirstExtras(),
        alignedScenes: collapsedAlignedScenes(),
        voiceoverDurationSec: 8,
        // Пресет с needsKeywordDetection: без ворот сюда уходил бы платный вызов
        // Anthropic — и оплачивался заново при каждом перезапуске обречённого ролика.
        subtitlePreset: "hormozi" as never,
      }),
    ).rejects.toThrow(/подгон/i)

    expect(h.keywordAgentCalls).toBe(0)
    expect(h.assembleCalls).toHaveLength(0)
    expect(stepFailed()).toBe(true)
  })

  it("на здоровом подгоне платный предпроход отрабатывает как раньше", async () => {
    const steps = await loadSteps()
    h.durationFit = { applied: true, trimmedCount: 1, heldCount: 0, totalDeltaSec: 0.2 }

    await steps.runAssembly(31, CLIPS, null, true, "", "", "portrait", plan(), {
      ...audioFirstExtras(),
      subtitlePreset: "hormozi" as never,
    })

    expect(h.keywordAgentCalls).toBe(1)
    expect(stepCompleted()).toBe(true)
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
