/**
 * Регрессия: фактический порядок нарезки клипов доезжает до шагов, которые
 * сопоставляют сцены плана с клипами.
 *
 * Клипы нарезаются в порядке `prompts.scenePrompts.scenes` — этот массив приходит
 * от модели и нигде не сортируется. Поэтому позиция сцены в `videoPlan.scenes`
 * индексом её клипа НЕ является.
 *
 * Дефекты:
 *  A) runLipSyncStep узнавал порядок только из снапшота prompt_generation. Нет
 *     снапшота — шаг честно пропускал ВСЕ сцены, и ролик оставался без lip-sync,
 *     хотя вызывающий держал порядок прямо в руках (результат runPromptGeneration).
 *  B) runAssembly ставил субтитру sceneIndex = позиция сцены в плане, а render
 *     кладёт субтитр на клип с этим индексом: при ответе модели [1,3,2] реплика
 *     сцены 2 уезжала на клип сцены 3.
 *  C) runVoiceoverGeneration брал длительность и файл клипа по позиции сцены —
 *     тот же промах, только с озвучкой и с удлинением клипов (extend_scene).
 *
 * DB-free: слой БД, TTS, ffmpeg-обёртки, storage и провайдеры замоканы,
 * автоимпортные глобалы Nuxt подменены фейками.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SubtitlePlacement } from "~~/shared/types/story"
import { VOICE_LEAD_IN_SEC } from "~~/shared/types/video-runtime"

// ── Шаги пайплайна: подменяем только «долгие» раннеры, остальное — настоящее ──

const stepsReal = vi.hoisted(() => ({
  mod: null as typeof import("../../../server/utils/video-pipeline-steps") | null,
}))

const stepCalls = vi.hoisted(() => ({
  voiceover: [] as unknown[][],
  assembly: [] as unknown[][],
  lipSync: [] as Array<{ clipSceneOrders?: readonly number[] | null }>,
}))

/** Порядок сцен, который «вернула модель» — им нарезаются клипы. */
const promptOrders = vi.hoisted(() => ({ value: [1, 3, 2] as number[] | null }))

vi.mock("../../../server/utils/video-pipeline-steps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/utils/video-pipeline-steps")>()
  // Настоящие runAssembly/runVoiceoverGeneration нужны отдельным тестам ниже —
  // держим ссылку на неподменённый модуль.
  stepsReal.mod = actual
  return {
    ...actual,
    runPromptGeneration: vi.fn(async () => ({
      hook: "hook",
      body: "body",
      cta: "cta",
      ...(promptOrders.value
        ? {
            scenePrompts: {
              scenes: promptOrders.value.map(order => ({ order, prompt: `p${order}`, purpose: "story" })),
            },
          }
        : {}),
    })),
    runImageGeneration: vi.fn(async () => ({ imagePaths: [], imageRemoteUrls: [], generatedCount: 0 })),
    runClipGeneration: vi.fn(async () => ({
      clipPaths: ["c0.mp4", "c1.mp4", "c2.mp4"],
      generatedCount: 0,
      scenes: [],
    })),
    runVoiceoverGeneration: vi.fn(async (...args: unknown[]) => {
      stepCalls.voiceover.push(args)
      return {
        status: "skipped",
        mixedPath: null,
        mixedDurationSec: 0,
        sceneResults: [],
        totalCostUsd: 0,
        provider: null,
        modelId: null,
        voiceId: null,
      }
    }),
    runMusicGeneration: vi.fn(async () => null),
    runAssembly: vi.fn(async (...args: unknown[]) => {
      stepCalls.assembly.push(args)
      return { filePath: "final.mp4", duration: 30 }
    }),
    loadEnrichmentContext: vi.fn(async () => ({
      accountStyleContext: null,
      appContext: null,
      favoritePrompts: [],
      appId: null,
      socialAccountId: null,
    })),
  }
})

vi.mock("../../../server/utils/lip-sync-runner", () => ({
  runLipSyncStep: vi.fn(async (input: { clipPaths: string[]; clipSceneOrders?: readonly number[] | null }) => {
    stepCalls.lipSync.push({ clipSceneOrders: input.clipSceneOrders })
    return {
      status: "skipped",
      clipPaths: input.clipPaths,
      syncedSceneCount: 0,
      totalCostUsd: 0,
      modelId: null,
    }
  }),
}))

// ── Слой БД и внешние сервисы ──

const stepLogs = vi.hoisted(() => ({ lines: [] as string[] }))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  // Порядок шагов копией: настоящий модуль тянет за собой fal-клиент, а нужен из
  // него только этот массив (по нему считается stepIndex).
  STEP_ORDER: [
    "prompt_generation",
    "image_generation",
    "clip_generation",
    "voiceover_generation",
    "music_generation",
    "lip_sync_generation",
    "assembly",
  ],
  acquireLock: vi.fn(async () => ({ videoId: 7, token: "t" })),
  releaseLock: vi.fn(async () => {}),
  forceReleaseLock: vi.fn(async () => {}),
  ensureStep: vi.fn(async () => ({ id: 1, attemptCount: 0, actualCost: 0, status: "pending", outputSnapshot: null })),
  updateStep: vi.fn(async () => {}),
  appendStepLog: vi.fn(async (_id: number, msg: string) => { stepLogs.lines.push(msg) }),
  isStepCompleted: vi.fn(() => false),
  updateVideoStatus: vi.fn(async () => {}),
  falStepRequest: vi.fn(async () => {}),
}))

vi.mock("../../../server/utils/fal", () => ({
  falProbeAccessBatch: vi.fn(async () => new Map()),
  falUploadFile: vi.fn(async () => "https://fal/upload"),
}))

vi.mock("../../../server/utils/video-cost", () => ({
  estimateVideoCost: vi.fn(() => ({ total: 0, breakdown: [] })),
}))

const planHolder = vi.hoisted(() => ({ plan: null as unknown }))

vi.mock("../../../server/utils/story-video-planner", () => ({
  buildStoryVideoPlan: vi.fn(() => planHolder.plan),
}))

vi.mock("../../../server/utils/replicate/cancel", () => ({
  cancelReplicatePredictionsForVideo: vi.fn(async () => ({ canceled: 0, failed: 0 })),
}))

vi.mock("../../../server/utils/balance/cost-ledger", () => ({
  logStepCost: vi.fn(async () => {}),
}))

vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: vi.fn(async () => ({
    storageKey: "videos/7/final.mp4",
    storageProvider: "local",
    fileSizeBytes: 10,
    fileSha256: "abc",
  })),
}))

vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: vi.fn(() => "/api/files/final.mp4"),
}))

/** Что уехало в микс: по стартам сцен и видно, на какой клип легла реплика. */
const mixCalls = vi.hoisted(() => ({ scenes: [] as Array<{ sceneOrder: number; sceneStartSec: number }> }))

/** Синтез не ходит в сеть: длительность реплики фиксирована. */
vi.mock("../../../server/utils/tts", () => ({
  synthesizeSpeech: vi.fn(async (opts: { outputPath: string }) => ({
    audioPath: opts.outputPath,
    durationSec: 4,
    model: { id: "fal-ai/kokoro/russian", name: "kokoro", provider: "fal" },
    voiceId: "voice-1",
    costUsd: 0.01,
    remoteUrl: null,
    characters: 10,
  })),
  buildVoiceoverTrack: vi.fn(async (opts: { scenes: Array<{ sceneOrder: number; sceneStartSec: number }> }) => {
    mixCalls.scenes = opts.scenes.map(s => ({ sceneOrder: s.sceneOrder, sceneStartSec: s.sceneStartSec }))
    return { durationSec: 27 }
  }),
  probeAudioDuration: vi.fn(async () => 4),
}))

/** ffmpeg-обёртки: реальных вызовов быть не должно. */
vi.mock("../../../server/utils/render", () => ({
  // Нормализация под concat: в тесте файлов нет, отдаём пути как есть.
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeClipDurations: vi.fn(async (paths: string[]) => paths.map((_, i) => [8, 9, 10][i] ?? 5)),
  // Замер по ячейкам сцен: пустая ячейка — дыра, а не файл (см.
  // probe-scene-clip-durations.spec.ts).
  probeSceneClipDurations: vi.fn(async (paths: string[]) =>
    paths.map((p, i) => (p.trim().length === 0 ? null : [8, 9, 10][i] ?? 5))),
  adjustAudioTempo: vi.fn(async () => ({ outputPath: "sped.mp3", durationSec: 4 })),
  trimAudio: vi.fn(async () => ({ outputPath: "trim.mp3", durationSec: 4 })),
  extendVideoClip: vi.fn(async (source: string) => ({ outputPath: `${source}_ext.mp4`, durationSec: 12 })),
  planClipExtension: vi.fn(() => ({ allowed: false, neededSec: 0, limitSec: 0 })),
}))

vi.mock("../../../server/utils/agents/subtitle-keyword-agent", () => ({
  runSubtitleKeywordAgent: vi.fn(async () => ({ segments: [] })),
}))

// ── Общие фикстуры ──

const BOTTOM: SubtitlePlacement = { position: "bottom", alignment: "center", avoidZones: [] }

/** Сцена плана: заполнены только поля, которые читают шаги. */
function scene(order: number, subtitleCopy = `sub-${order}`, durationSec = 5) {
  return { order, durationSec, subtitleCopy, subtitlePlacement: BOTTOM }
}

function makePlan(scenes: ReturnType<typeof scene>[], voiceoverLines?: number[]) {
  return {
    mode: "story_driven",
    scenes,
    subtitleStyle: null,
    warnings: [],
    skipImageGeneration: false,
    ...(voiceoverLines
      ? {
          voiceoverPlan: {
            enabled: true,
            lines: voiceoverLines.map(sceneOrder => ({
              sceneOrder,
              text: `реплика ${sceneOrder}`,
              emotion: "neutral",
            })),
          },
        }
      : {}),
  } as unknown as StoryDrivenVideoPlan
}

const VIDEO_ROW = {
  id: 7,
  imageModelId: "fal-ai/flux/dev",
  videoModelId: "fal-ai/kling-video/v3/standard/text-to-video",
  modelStrategy: "auto",
  imageCount: 3,
  clipDuration: 5,
  format: "portrait",
  renderQuality: "medium",
  generateAudio: false,
  musicEnabled: false,
  musicMood: null,
  musicDuration: null,
  musicVolume: null,
  musicVolumeWithVoiceover: null,
  subtitlesEnabled: true,
  subtitlePreset: null,
  subtitlesStyle: null,
  targetPlatform: "tiktok",
  voiceoverEnabled: false,
  voiceoverModelId: null,
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "slow",
  voiceoverReconciliation: "compress_audio",
  lipSyncEnabled: true,
  lipSyncModelId: null,
  lipSyncCharacterId: null,
  scenario: {
    id: 3,
    appId: null,
    variants: [{ id: 10, variantIndex: 0, status: "accepted", storyPlan: null, hook: "H", cta: "C" }],
  },
}

/** Автоимпорты Nuxt: в чистом vitest их нет — ставим фейки до импорта модулей. */
function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.logAgent = async () => {}
  g.getVideosDir = () => tmpdir()
  g.getAssetsDir = () => tmpdir()
  g.ensureDir = async () => {}
  g.safeUnlink = async () => {}
  g.assembleVideo = async (opts: unknown) => {
    assembleCalls.push(opts as AssembleCall)
    return { filePath: "final.mp4", duration: 30 }
  }
  g.prisma = {
    video: {
      findUnique: async (args: { select?: Record<string, unknown> }) =>
        args?.select ? { subtitlesStyle: null } : VIDEO_ROW,
      update: async () => ({}),
    },
    scenarioVariant: { findFirst: async () => null, update: async () => ({}) },
    videoGenerationStep: {
      findFirst: async () => ({ id: 1, attemptCount: 0, actualCost: 0 }),
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
    },
    videoAsset: {
      count: async () => 0,
      findFirst: async () => null,
      create: async () => ({ id: 1 }),
      update: async () => ({ id: 1 }),
    },
    // Задача 7: `sceneMediaNeeded` (video-pipeline.ts) считает ФАКТ кадров
    // запросом videoShot.count — этот файл кадровый маршрут не проверяет,
    // ноль кадров сохраняет для него прежнее (посценное) поведение.
    videoShot: { count: async () => 0 },
  }
}

type AssembleCall = {
  sceneSubtitles?: Array<{ sceneIndex: number; text: string }>
}
const assembleCalls: AssembleCall[] = []

async function loadPipeline() {
  installGlobals()
  const mod = await import("../../../server/utils/video-pipeline")
  return mod.runVideoPipeline
}

async function loadRealSteps() {
  installGlobals()
  // Импорт замоканного модуля наполняет stepsReal.mod настоящей реализацией.
  await import("../../../server/utils/video-pipeline-steps")
  return stepsReal.mod!
}

beforeEach(() => {
  stepCalls.voiceover.length = 0
  stepCalls.assembly.length = 0
  stepCalls.lipSync.length = 0
  stepLogs.lines.length = 0
  assembleCalls.length = 0
  mixCalls.scenes = []
  promptOrders.value = [1, 3, 2]
  planHolder.plan = makePlan([scene(1), scene(2), scene(3)])
})

describe("runVideoPipeline: порядок нарезки клипов уходит в шаги", () => {
  it("lip-sync получает порядок сцен из результата промптов, а не только из снапшота БД", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(7)

    // Порядок известен прямо в прогоне: без него шаг ушёл бы читать снапшот
    // prompt_generation, а без снапшота пропустил бы все сцены.
    expect(stepCalls.lipSync).toHaveLength(1)
    expect(stepCalls.lipSync[0]!.clipSceneOrders).toEqual([1, 3, 2])
  })

  it("озвучка и сборка получают тот же порядок", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(7)

    expect(stepCalls.voiceover[0]![4]).toEqual([1, 3, 2])
    const assemblyExtras = stepCalls.assembly[0]![8] as { clipSceneOrders?: number[] }
    expect(assemblyExtras.clipSceneOrders).toEqual([1, 3, 2])
  })

  it("legacy-прогон без scenePrompts не выдумывает порядок", async () => {
    promptOrders.value = null
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(7)

    expect(stepCalls.lipSync[0]!.clipSceneOrders).toBeUndefined()
    expect(stepCalls.voiceover[0]![4]).toBeUndefined()
  })
})

describe("runAssembly: субтитр ложится на клип своей сцены", () => {
  it("модель переставила сцены — субтитры едут по порядку нарезки, а не по позициям плана", async () => {
    const steps = await loadRealSteps()
    const plan = makePlan([scene(1, "Первая"), scene(2, "Вторая"), scene(3, "Третья")])

    await steps.runAssembly(7, ["c0.mp4", "c1.mp4", "c2.mp4"], null, true, "", "", "portrait", plan, {
      clipSceneOrders: [1, 3, 2],
    })

    const subs = assembleCalls[0]!.sceneSubtitles!
    // Клип сцены 2 — последний (индекс 2), клип сцены 3 — средний (индекс 1).
    expect(subs.map(s => ({ text: s.text, sceneIndex: s.sceneIndex }))).toEqual([
      { text: "Первая", sceneIndex: 0 },
      { text: "Вторая", sceneIndex: 2 },
      { text: "Третья", sceneIndex: 1 },
    ])
  })

  it("сцена, которой нет в порядке нарезки, теряет субтитр, а не занимает чужой клип", async () => {
    const steps = await loadRealSteps()
    const plan = makePlan([scene(1, "Первая"), scene(2, "Вторая"), scene(4, "Четвёртая")])

    await steps.runAssembly(7, ["c0.mp4", "c1.mp4"], null, true, "", "", "portrait", plan, {
      clipSceneOrders: [1, 2],
    })

    expect(assembleCalls[0]!.sceneSubtitles!.map(s => s.text)).toEqual(["Первая", "Вторая"])
  })

  it("порядок не передан — прежняя позиционная раскладка плюс предупреждение в логе шага", async () => {
    const steps = await loadRealSteps()
    const plan = makePlan([scene(1, "Первая"), scene(2, ""), scene(3, "Третья")])

    await steps.runAssembly(7, ["c0.mp4", "c1.mp4", "c2.mp4"], null, true, "", "", "portrait", plan)

    expect(assembleCalls[0]!.sceneSubtitles!.map(s => s.sceneIndex)).toEqual([0, 2])
    expect(stepLogs.lines.some(l => l.includes("Порядок нарезки клипов не передан"))).toBe(true)
  })
})

describe("runVoiceoverGeneration: реплика ложится на клип своей сцены", () => {
  const VOICE_CONFIG = {
    voiceoverEnabled: true,
    voiceoverModelId: null,
    voiceoverVoiceId: null,
    voiceoverLanguage: "ru",
    voiceoverPacing: "slow" as const,
    voiceoverReconciliation: "compress_audio" as const,
    modelStrategy: "budget",
  }

  it("старт сцены считается по её клипу, а не по позиции в плане", async () => {
    const steps = await loadRealSteps()
    const plan = makePlan([scene(1), scene(2), scene(3)], [1, 2, 3])

    // Клипы длительностью 8/9/10 нарезаны в порядке сцен [1, 3, 2]:
    // старт клипа 0 = 0, клипа 1 = 8, клипа 2 = 17.
    await steps.runVoiceoverGeneration(7, ["c0.mp4", "c1.mp4", "c2.mp4"], VOICE_CONFIG, plan, [1, 3, 2])

    expect(mixCalls.scenes).toEqual([
      { sceneOrder: 1, sceneStartSec: 0 + VOICE_LEAD_IN_SEC },
      { sceneOrder: 2, sceneStartSec: 17 + VOICE_LEAD_IN_SEC },
      { sceneOrder: 3, sceneStartSec: 8 + VOICE_LEAD_IN_SEC },
    ])
  })

  it("сцены без клипа озвучка пропускает, а не сажает на соседний", async () => {
    const steps = await loadRealSteps()
    const plan = makePlan([scene(1), scene(4)], [1, 4])

    await steps.runVoiceoverGeneration(7, ["c0.mp4"], VOICE_CONFIG, plan, [1])

    expect(mixCalls.scenes).toEqual([{ sceneOrder: 1, sceneStartSec: VOICE_LEAD_IN_SEC }])
  })

  it("порядок не передан — прежняя позиционная раскладка плюс предупреждение в логе шага", async () => {
    const steps = await loadRealSteps()
    const plan = makePlan([scene(1), scene(2), scene(3)], [1, 2, 3])

    await steps.runVoiceoverGeneration(7, ["c0.mp4", "c1.mp4", "c2.mp4"], VOICE_CONFIG, plan)

    expect(mixCalls.scenes).toEqual([
      { sceneOrder: 1, sceneStartSec: 0 + VOICE_LEAD_IN_SEC },
      { sceneOrder: 2, sceneStartSec: 8 + VOICE_LEAD_IN_SEC },
      { sceneOrder: 3, sceneStartSec: 17 + VOICE_LEAD_IN_SEC },
    ])
    expect(stepLogs.lines.some(l => l.includes("Порядок нарезки клипов не передан"))).toBe(true)
  })
})
