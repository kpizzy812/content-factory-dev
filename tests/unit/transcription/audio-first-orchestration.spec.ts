/**
 * Оркестратор ведёт прогон по МАРШРУТУ РОЛИКА.
 *
 * Проверяется то, что нельзя увидеть в порядке шагов (`planPipelineRun`), а
 * только в самом теле прогона:
 *  - на audio-first озвучка и транскрипция вызываются ДО картинки и клипов;
 *  - lip-sync получает трек с отпечатком и fps сборки, а не дефолтом шага;
 *  - кэш озвучки на этом маршруте НЕ сбрасывается свежими клипами (там лежит
 *    уже оплаченный единый трек, а не микс, посчитанный от клипов);
 *  - сборка получает трек как звук ролика и выровненные сцены;
 *  - у ролика без editPipeline порядок вызовов и сброс кэша прежние.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import { TIMELINE_FPS, type StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const calls = vi.hoisted(() => ({
  order: [] as string[],
  assembly: [] as unknown[][],
  lipSync: [] as Array<Record<string, unknown>>,
  /** Вызовы updateMany по шагам — ими и только ими сбрасывается кэш озвучки. */
  stepUpdateMany: [] as Array<Record<string, unknown>>,
}))

const track = vi.hoisted(() => ({
  value: {
    status: "completed",
    trackPath: "/tmp/voiceover_track.mp3",
    durationSec: 24.4,
    trackFingerprint: "sha-финального-файла",
    storageKey: "zavodcamp/videos/44/voiceover_mix.mp3",
    scenes: [{ order: 1, text: "первая" }, { order: 2, text: "вторая" }],
    totalCostUsd: 0.07,
    modelId: "minimax/speech-02-turbo",
    voiceId: "clone-1",
  } as Record<string, unknown>,
}))

const aligned = vi.hoisted(() => ({
  value: [
    { order: 1, startSec: 0, endSec: 6.2, words: [] },
    { order: 2, startSec: 6.2, endSec: 24.4, words: [] },
  ] as unknown[],
}))

vi.mock("../../../server/utils/video-pipeline-steps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/utils/video-pipeline-steps")>()
  return {
    ...actual,
    runPromptGeneration: vi.fn(async () => {
      calls.order.push("prompt_generation")
      return {
        hook: "h",
        body: "b",
        cta: "c",
        scenePrompts: { scenes: [1, 2].map(order => ({ order, prompt: `p${order}` })) },
      }
    }),
    runAudioFirstVoiceover: vi.fn(async () => {
      calls.order.push("voiceover_generation")
      return track.value
    }),
    runVideoTranscription: vi.fn(async () => {
      calls.order.push("transcription")
      return { status: "completed", scenes: aligned.value, costUsd: 0.01, warning: null }
    }),
    runImageGeneration: vi.fn(async () => {
      calls.order.push("image_generation")
      return { imagePaths: [], imageRemoteUrls: [], generatedCount: 0 }
    }),
    runClipGeneration: vi.fn(async () => {
      calls.order.push("clip_generation")
      return { clipPaths: ["c0.mp4", "c1.mp4"], generatedCount: 0, scenes: [] }
    }),
    runVoiceoverGeneration: vi.fn(async () => {
      calls.order.push("voiceover_generation")
      return {
        status: "completed",
        mixedPath: "mix.mp3",
        mixedDurationSec: 11,
        sceneResults: [],
        totalCostUsd: 0,
        provider: "fish",
        modelId: "fish",
        voiceId: "v",
      }
    }),
    runMusicGeneration: vi.fn(async () => {
      calls.order.push("music_generation")
      return null
    }),
    runAssembly: vi.fn(async (...args: unknown[]) => {
      calls.order.push("assembly")
      calls.assembly.push(args)
      return { filePath: "final.mp4", duration: 24 }
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
  runLipSyncStep: vi.fn(async (input: Record<string, unknown>) => {
    calls.order.push("lip_sync_generation")
    calls.lipSync.push(input)
    return {
      status: "completed",
      clipPaths: ["c0_lipsync.mp4", "c1_lipsync.mp4"],
      syncedSceneCount: 2,
      // Свежие файлы губ: именно они на СТАРОМ маршруте обесценивают кэш озвучки.
      resyncedSceneCount: 2,
      totalCostUsd: 0.5,
      modelId: "kling-lip-sync",
    }
  }),
}))

vi.mock("../../../server/utils/render", () => ({
  normalizeSceneClips: async (paths: string[]) => [...paths],
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  STEP_ORDER: [
    "prompt_generation", "image_generation", "clip_generation",
    "voiceover_generation", "music_generation", "lip_sync_generation", "assembly",
    "transcription",
  ],
  acquireLock: vi.fn(async () => ({ videoId: 44, token: "t" })),
  releaseLock: vi.fn(async () => {}),
  forceReleaseLock: vi.fn(async () => {}),
  ensureStep: vi.fn(async () => ({ id: 1, attemptCount: 0, actualCost: 0, status: "pending", outputSnapshot: null })),
  updateStep: vi.fn(async () => {}),
  appendStepLog: vi.fn(async () => {}),
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
vi.mock("../../../server/utils/replicate/cancel", () => ({
  cancelReplicatePredictionsForVideo: vi.fn(async () => ({ canceled: 0, failed: 0 })),
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: vi.fn(async () => {}) }))
vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: vi.fn(async () => ({
    storageKey: "videos/44/final.mp4", storageProvider: "local", fileSizeBytes: 10, fileSha256: "a",
  })),
}))
vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: vi.fn(() => "/api/files/final.mp4"),
}))

const planHolder = vi.hoisted(() => ({ plan: null as unknown }))
vi.mock("../../../server/utils/story-video-planner", () => ({
  buildStoryVideoPlan: vi.fn(() => planHolder.plan),
}))

const routeHolder = vi.hoisted(() => ({ editPipeline: true }))

const VIDEO_ROW = {
  id: 44,
  imageModelId: "fal-ai/flux/dev",
  videoModelId: "fal-ai/kling-video/v3/standard/text-to-video",
  modelStrategy: "auto",
  imageCount: 2,
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
  voiceoverEnabled: true,
  voiceoverModelId: null,
  voiceoverVoiceId: "clone-1",
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate",
  voiceoverReconciliation: "compress_audio",
  lipSyncEnabled: true,
  lipSyncModelId: null,
  lipSyncCharacterId: "character-1",
  scenario: {
    id: 3,
    appId: null,
    variants: [{ id: 10, variantIndex: 0, status: "accepted", storyPlan: null, hook: "H", cta: "C" }],
  },
}

function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.logAgent = async () => {}
  g.getVideosDir = () => tmpdir()
  g.getAssetsDir = () => tmpdir()
  g.ensureDir = async () => {}
  g.safeUnlink = async () => {}
  g.assembleVideo = async () => ({ filePath: "final.mp4", duration: 24 })
  g.prisma = {
    video: {
      findUnique: async (args: { select?: Record<string, unknown> }) =>
        args?.select
          ? { subtitlesStyle: null, editPipeline: routeHolder.editPipeline }
          : { ...VIDEO_ROW, editPipeline: routeHolder.editPipeline },
      update: async () => ({}),
    },
    scenarioVariant: { findFirst: async () => null, update: async () => ({}) },
    videoGenerationStep: {
      findFirst: async () => ({ id: 1, attemptCount: 0, actualCost: 0 }),
      findMany: async () => [],
      updateMany: async (args: Record<string, unknown>) => {
        calls.stepUpdateMany.push(args)
        return { count: 0 }
      },
    },
    videoAsset: { count: async () => 0, findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
  }
}

/** Две сцены, обе играет ведущий: маршрут audio-first ради них и существует. */
function plan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [1, 2].map(order => ({
      order,
      durationSec: 10,
      spokenLine: `реплика ${order}`,
      subtitleCopy: `sub-${order}`,
      subtitlePlacement: { position: "bottom", alignment: "center", avoidZones: [] },
    })),
    subtitleStyle: null,
    warnings: [],
    skipImageGeneration: false,
    voiceoverPlan: { enabled: false, lines: [] },
  } as unknown as StoryDrivenVideoPlan
}

function assemblyExtras(): Record<string, unknown> {
  return calls.assembly[0]![8] as Record<string, unknown>
}

async function loadPipeline() {
  installGlobals()
  const mod = await import("../../../server/utils/video-pipeline")
  return mod.runVideoPipeline
}

beforeEach(() => {
  // Счётчики вызовов у модульных моков общие на весь файл — без сброса
  // «не вызывался» означало бы лишь «не вызывался в этом тесте, но в прошлом да».
  vi.clearAllMocks()
  calls.order.length = 0
  calls.assembly.length = 0
  calls.lipSync.length = 0
  calls.stepUpdateMany.length = 0
  planHolder.plan = plan()
  routeHolder.editPipeline = true
})

describe("оркестратор на маршруте audio-first", () => {
  it("озвучка и транскрипция идут до картинки и клипов", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(44)

    expect(calls.order).toEqual([
      "prompt_generation",
      "voiceover_generation",
      "transcription",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "music_generation",
      "assembly",
    ])
  })

  it("lip-sync получает трек, его отпечаток и fps сборки", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(44)

    expect(calls.lipSync[0]!.audioFirst).toMatchObject({
      trackPath: "/tmp/voiceover_track.mp3",
      trackDurationSec: 24.4,
      // Отпечаток ФИНАЛЬНОГО файла: ключи кусков считаются по тому же файлу,
      // из которого режется звук.
      trackFingerprint: "sha-финального-файла",
      // Дефолт шага (30) совпал бы случайно — здесь важно, что fps передан
      // ролику явно и берётся из константы таймлайна.
      fps: TIMELINE_FPS,
    })
    expect((calls.lipSync[0]!.audioFirst as { scenes: unknown[] }).scenes).toEqual(aligned.value)
  })

  it("свежие клипы lip-sync НЕ сбрасывают кэш озвучки — там оплаченный единый трек", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(44)

    expect(calls.stepUpdateMany).toEqual([])
  })

  it("сборка получает трек как звук ролика и выровненные сцены", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(44)

    expect(assemblyExtras().voiceoverPath).toBe("/tmp/voiceover_track.mp3")
    expect(assemblyExtras().alignedScenes).toEqual(aligned.value)
  })

  it("без единого трека прогон не останавливается — озвучка идёт посценным маршрутом", async () => {
    track.value = { ...track.value, status: "skipped", trackPath: null, trackFingerprint: null, reason: "empty_script" }
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(44)

    // Транскрипции нет (транскрибировать нечего), а озвучка отработала обычным
    // шагом — ролик всё равно собран.
    expect(calls.order).toEqual([
      "prompt_generation",
      "voiceover_generation",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "voiceover_generation",
      "music_generation",
      "assembly",
    ])
    expect(calls.lipSync[0]!.audioFirst).toBeNull()
  })
})

describe("оркестратор на старом маршруте", () => {
  beforeEach(() => {
    routeHolder.editPipeline = false
  })

  it("порядок вызовов прежний: картинка и клипы до озвучки", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(44)

    expect(calls.order).toEqual([
      "prompt_generation",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "voiceover_generation",
      "music_generation",
      "assembly",
    ])
  })

  it("единый трек не синтезируется вовсе, а lip-sync работает посценно", async () => {
    const steps = await import("../../../server/utils/video-pipeline-steps")
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(44)

    expect(steps.runAudioFirstVoiceover).not.toHaveBeenCalled()
    expect(steps.runVideoTranscription).not.toHaveBeenCalled()
    expect(calls.lipSync[0]!.audioFirst).toBeNull()
  })

  it("свежие клипы lip-sync по-прежнему сбрасывают кэш озвучки", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(44)

    expect(calls.stepUpdateMany).toHaveLength(1)
    expect(calls.stepUpdateMany[0]).toMatchObject({
      where: { videoId: 44, stepKey: { in: ["voiceover_generation"] } },
    })
  })

  it("сборка не получает выравнивания — его на этом маршруте нет", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(44)

    expect(assemblyExtras().alignedScenes).toBeUndefined()
  })
})
