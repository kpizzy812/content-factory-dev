/**
 * Регрессия: отрезки, где сборка глушит звук клипов, берутся из ФАКТИЧЕСКОГО
 * микса озвучки, а не пересчитываются оркестратором по плану.
 *
 * Дефект ролика 23: планировщик ставил всем девяти сценам `durationSec: 10`, и
 * оркестратор складывал старты сцен из этой константы. Реальные клипы такой
 * длины не имели, поэтому звук клипов приглушался не там, где идёт речь, — ещё
 * один таймлайн вдобавок к двум существующим. Шаг озвучки знает настоящие
 * старты (он сам сводил микс) и теперь их отдаёт.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const calls = vi.hoisted(() => ({ assembly: [] as unknown[][] }))
const voiceoverResult = vi.hoisted(() => ({
  value: null as unknown,
}))

vi.mock("../../../server/utils/video-pipeline-steps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/utils/video-pipeline-steps")>()
  return {
    ...actual,
    runPromptGeneration: vi.fn(async () => ({
      hook: "h",
      body: "b",
      cta: "c",
      scenePrompts: { scenes: [1, 2].map(order => ({ order, prompt: `p${order}` })) },
    })),
    runImageGeneration: vi.fn(async () => ({ imagePaths: [], imageRemoteUrls: [], generatedCount: 0 })),
    runClipGeneration: vi.fn(async () => ({
      clipPaths: ["c0.mp4", "c1.mp4"],
      generatedCount: 0,
      scenes: [],
    })),
    runVoiceoverGeneration: vi.fn(async () => voiceoverResult.value),
    runMusicGeneration: vi.fn(async () => null),
    runAssembly: vi.fn(async (...args: unknown[]) => {
      calls.assembly.push(args)
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
  runLipSyncStep: vi.fn(async (input: { clipPaths: string[] }) => ({
    status: "skipped",
    clipPaths: input.clipPaths,
    syncedSceneCount: 0,
    resyncedSceneCount: 0,
    totalCostUsd: 0,
    modelId: null,
  })),
}))

// Приведение клипов под concat идёт до озвучки и трогает ffmpeg — в тесте
// файлов нет, поэтому пути возвращаются как есть.
vi.mock("../../../server/utils/render", () => ({
  normalizeSceneClips: async (paths: string[]) => [...paths],
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  STEP_ORDER: [
    "prompt_generation", "image_generation", "clip_generation",
    "voiceover_generation", "music_generation", "lip_sync_generation", "assembly",
  ],
  acquireLock: vi.fn(async () => ({ videoId: 31, token: "t" })),
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
    storageKey: "videos/31/final.mp4", storageProvider: "local", fileSizeBytes: 10, fileSha256: "a",
  })),
}))
vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: vi.fn(() => "/api/files/final.mp4"),
}))

const planHolder = vi.hoisted(() => ({ plan: null as unknown }))
vi.mock("../../../server/utils/story-video-planner", () => ({
  buildStoryVideoPlan: vi.fn(() => planHolder.plan),
}))

const VIDEO_ROW = {
  id: 31,
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
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate",
  voiceoverReconciliation: "compress_audio",
  lipSyncEnabled: false,
  lipSyncModelId: null,
  lipSyncCharacterId: null,
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
  g.assembleVideo = async () => ({ filePath: "final.mp4", duration: 30 })
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
    videoAsset: { count: async () => 0, findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
  }
}

/** Две сцены, по плану — по десять секунд каждая. Фактические клипы короче. */
function plan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [1, 2].map(order => ({
      order,
      durationSec: 10,
      subtitleCopy: `sub-${order}`,
      subtitlePlacement: { position: "bottom", alignment: "center", avoidZones: [] },
    })),
    subtitleStyle: null,
    warnings: [],
    skipImageGeneration: false,
    voiceoverPlan: {
      enabled: true,
      lines: [1, 2].map(sceneOrder => ({ sceneOrder, text: `реплика ${sceneOrder}`, emotion: "neutral" })),
    },
  } as unknown as StoryDrivenVideoPlan
}

function assemblyExtras(): { voiceoverIntervals?: Array<{ startSec: number; endSec: number }> } {
  return calls.assembly[0]![8] as { voiceoverIntervals?: Array<{ startSec: number; endSec: number }> }
}

async function loadPipeline() {
  installGlobals()
  const mod = await import("../../../server/utils/video-pipeline")
  return mod.runVideoPipeline
}

beforeEach(() => {
  calls.assembly.length = 0
  planHolder.plan = plan()
  voiceoverResult.value = {
    status: "completed",
    mixedPath: "mix.mp3",
    mixedDurationSec: 11,
    sceneResults: [
      { sceneOrder: 1, audioPath: "a1.mp3", durationSec: 4, characters: 10, reconciliation: "none" },
      { sceneOrder: 2, audioPath: "a2.mp3", durationSec: 4, characters: 10, reconciliation: "none" },
    ],
    // Факт: первый клип 6 секунд, второй 5 — интервалы речи считал сам шаг.
    voicedIntervals: [{ startSec: 0, endSec: 4 }, { startSec: 6, endSec: 10 }],
    totalCostUsd: 0,
    provider: "fish",
    modelId: "fish",
    voiceId: "v",
  }
})

describe("runVideoPipeline: дакинг звука клипов идёт по миксу", () => {
  it("сборка получает интервалы шага озвучки, а не пересчёт по плановым длительностям", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(31)

    // Пересчёт по плану дал бы [0..4] и [10..14] — вторая сцена начинается на
    // десятой секунде только на бумаге.
    expect(assemblyExtras().voiceoverIntervals).toEqual([
      { startSec: 0, endSec: 4 },
      { startSec: 6, endSec: 10 },
    ])
  })

  it("снапшот старого формата без интервалов не выдумывает их из плана", async () => {
    const cached = { ...(voiceoverResult.value as Record<string, unknown>) }
    delete cached.voicedIntervals
    voiceoverResult.value = cached
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(31)

    expect(assemblyExtras().voiceoverIntervals).toBeUndefined()
  })
})
