/**
 * Регрессия: свежий lip-sync обесценивает кэш шага озвучки ЦЕЛИКОМ.
 *
 * Дефект. Оркестратор отказывался брать из кэша озвучки только clipPaths, но
 * продолжал использовать её voiceover_mix — а микс сведён по таймлайну ТЕХ клипов:
 * политика extend_scene удлиняет клип сцены и сдвигает старты всех последующих
 * реплик. Сценарий из жизни: прогон 1 синхронизировал сцены 1-2, на сцене 3 упал
 * TTS, extend_scene удлинила клип сцены 1 на +2 с, микс сохранён по удлинённому
 * таймлайну. Прогон 2: сцена 3 синхронизировалась, удлинённые клипы отброшены как
 * «относящиеся к прошлым», а микс остался прежним — звук уехал относительно
 * картинки на все +2 с.
 *
 * Фикс: если lip-sync выдал новые файлы, шаг voiceover_generation сбрасывается тем
 * же патчем, что и rerunVideoStep, и переигрывается на свежих клипах. Ассеты при
 * этом НЕ сносятся: реплики сцен шаг переиспользует (TTS повторно не оплачивается),
 * пересобираются ровно тайминги и микс.
 *
 * DB-free: слой БД — карта строк шагов в памяти, шаги-раннеры замоканы, сеть и
 * ffmpeg не задействованы. Модуль сброса (STEP_RERUN_RESET_PATCH) — настоящий.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import { STEP_RERUN_RESET_PATCH } from "../../../server/utils/video-pipeline-reset"
import {
  snapshotInvalidationPatch,
  stepsInvalidatedByFreshClips,
} from "../../../server/utils/video-pipeline-run-policy"

// ── Строки шагов в памяти: ровно то состояние, ради которого шаг делает ранний
//    возврат снапшота ──

interface StepRow {
  id: number
  stepKey: string
  status: string
  attemptCount: number
  actualCost: number | null
  outputSnapshot: Record<string, unknown> | null
}

const db = vi.hoisted(() => ({
  steps: new Map<string, StepRow>(),
  assetDeleteMany: 0,
}))

/** Микс кодирует таймлайн, по которому сведён: видно, от каких клипов он посчитан. */
const mixPathFor = (clipPaths: readonly string[]) => `mix(${clipPaths.join("+")}).mp3`

const calls = vi.hoisted(() => ({
  voiceover: [] as Array<{ clipPaths: string[]; fromCache: boolean }>,
  assembly: [] as Array<{ clipPaths: string[]; voiceoverPath: string | null }>,
}))

/** Что вернёт lip-sync в этом прогоне. */
const lipSync = vi.hoisted(() => ({
  status: "completed" as "completed" | "skipped" | "disabled",
  resyncedSceneCount: 2,
  clipPaths: [] as string[],
}))

vi.mock("../../../server/utils/lip-sync-runner", () => ({
  runLipSyncStep: vi.fn(async (input: { clipPaths: string[] }) => ({
    status: lipSync.status,
    clipPaths: lipSync.clipPaths.length > 0 ? lipSync.clipPaths : input.clipPaths,
    syncedSceneCount: lipSync.resyncedSceneCount,
    resyncedSceneCount: lipSync.resyncedSceneCount,
    totalCostUsd: 0.14,
    modelId: "kling-lip-sync",
  })),
}))

vi.mock("../../../server/utils/video-pipeline-steps", () => ({
  loadEnrichmentContext: vi.fn(async () => ({
    accountStyleContext: null,
    appContext: null,
    favoritePrompts: [],
    appId: null,
    socialAccountId: null,
  })),
  runPromptGeneration: vi.fn(async () => ({
    hook: "hook",
    body: "body",
    cta: "cta",
    scenePrompts: { scenes: [1, 2, 3].map(order => ({ order, prompt: `p${order}` })) },
  })),
  runImageGeneration: vi.fn(async () => ({ imagePaths: [], imageRemoteUrls: [], generatedCount: 0 })),
  runClipGeneration: vi.fn(async () => ({
    clipPaths: ["c0.mp4", "c1.mp4", "c2.mp4"],
    generatedCount: 0,
    scenes: [],
  })),
  // Симуляция настоящего runVoiceoverGeneration в части, которая тут и проверяется:
  // ранний возврат снапшота у completed-шага, а иначе — сведение микса по ТЕМ
  // клипам, которые шагу передали, плюс удлинение клипов политикой extend_scene.
  runVoiceoverGeneration: vi.fn(async (_videoId: number, clipPaths: string[]) => {
    const step = db.steps.get("voiceover_generation")!
    if (step.status === "completed" && step.outputSnapshot?.mixedPath) {
      calls.voiceover.push({ clipPaths: [...clipPaths], fromCache: true })
      return step.outputSnapshot
    }
    calls.voiceover.push({ clipPaths: [...clipPaths], fromCache: false })
    step.attemptCount += 1
    const extended = clipPaths.map(path => path.replace(/\.mp4$/, "_ext.mp4"))
    const result = {
      status: "completed",
      mixedPath: mixPathFor(extended),
      mixedDurationSec: 27,
      sceneResults: [],
      totalCostUsd: 0,
      provider: "fal",
      modelId: "fal-ai/kokoro/russian",
      voiceId: "voice-1",
      clipPaths: extended,
    }
    step.status = "completed"
    step.outputSnapshot = result
    return result
  }),
  runMusicGeneration: vi.fn(async () => null),
  runAssembly: vi.fn(async (
    _videoId: number,
    clipPaths: string[],
    _musicPath: unknown,
    _subs: unknown,
    _hook: unknown,
    _cta: unknown,
    _format: unknown,
    _plan: unknown,
    extras?: { voiceoverPath?: string | null },
  ) => {
    calls.assembly.push({ clipPaths: [...clipPaths], voiceoverPath: extras?.voiceoverPath ?? null })
    return { filePath: "final.mp4", duration: 30 }
  }),
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  STEP_ORDER: [
    "prompt_generation",
    "image_generation",
    "clip_generation",
    "voiceover_generation",
    "music_generation",
    "lip_sync_generation",
    "assembly",
  ],
  acquireLock: vi.fn(async () => ({ videoId: 7, stampMs: 1 })),
  releaseLock: vi.fn(async () => {}),
  forceReleaseLock: vi.fn(async () => {}),
  ensureStep: vi.fn(async (_videoId: number, stepKey: string) => db.steps.get(stepKey)!),
  updateStep: vi.fn(async (id: number, patch: Record<string, unknown>) => {
    for (const row of db.steps.values()) {
      if (row.id === id) Object.assign(row, patch)
    }
  }),
  isStepCompleted: vi.fn((step: { status: string }) => step.status === "completed"),
  updateVideoStatus: vi.fn(async () => {}),
}))

vi.mock("../../../server/utils/fal", () => ({
  falProbeAccessBatch: vi.fn(async () => new Map()),
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

// ── Фикстуры ──

function makePlan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [1, 2, 3].map(order => ({ order, durationSec: 5, subtitleCopy: "", spokenLine: `Реплика ${order}` })),
    subtitleStyle: null,
    warnings: [],
    skipImageGeneration: false,
    voiceoverPlan: {
      enabled: true,
      lines: [1, 2, 3].map(sceneOrder => ({ sceneOrder, text: `реплика ${sceneOrder}`, emotion: "neutral" })),
    },
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
  voiceoverEnabled: true,
  voiceoverModelId: "fal-ai/kokoro/russian",
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate",
  // Ровно та политика, которая удлиняет клипы и делает микс привязанным к файлам.
  voiceoverReconciliation: "extend_scene",
  lipSyncEnabled: true,
  lipSyncModelId: null,
  lipSyncCharacterId: null,
  scenario: {
    id: 3,
    appId: null,
    variants: [{ id: 10, variantIndex: 0, status: "accepted", storyPlan: null, hook: "H", cta: "C" }],
  },
}

function stepRow(stepKey: string, id: number, patch: Partial<StepRow> = {}): StepRow {
  return {
    id,
    stepKey,
    status: "pending",
    attemptCount: 0,
    actualCost: null,
    outputSnapshot: null,
    ...patch,
  }
}

/** Прогон 1: озвучка отработала на клипах c0/c1/c2 и удлинила клип сцены 1. */
const STALE_CLIP_PATHS = ["c0_ext.mp4", "c1.mp4", "c2.mp4"]
const STALE_MIX = mixPathFor(STALE_CLIP_PATHS)

function seedSteps(): void {
  db.steps.clear()
  db.steps.set("prompt_generation", stepRow("prompt_generation", 1, { status: "completed", attemptCount: 1 }))
  db.steps.set("image_generation", stepRow("image_generation", 2, { status: "completed", attemptCount: 1 }))
  db.steps.set("clip_generation", stepRow("clip_generation", 3, { status: "completed", attemptCount: 1 }))
  db.steps.set("lip_sync_generation", stepRow("lip_sync_generation", 4, { status: "completed", attemptCount: 1 }))
  db.steps.set("voiceover_generation", stepRow("voiceover_generation", 5, {
    status: "completed",
    attemptCount: 1,
    actualCost: 0.42,
    outputSnapshot: {
      status: "completed",
      mixedPath: STALE_MIX,
      mixedDurationSec: 29,
      sceneResults: [],
      totalCostUsd: 0.42,
      provider: "fal",
      modelId: "fal-ai/kokoro/russian",
      voiceId: "voice-1",
      clipPaths: [...STALE_CLIP_PATHS],
    },
  }))
  db.steps.set("music_generation", stepRow("music_generation", 6, { status: "skipped" }))
  db.steps.set("assembly", stepRow("assembly", 7))
}

/** Автоимпорты Nuxt: в чистом vitest их нет — ставим фейки до импорта модулей. */
function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.logAgent = async () => {}
  g.getVideosDir = () => tmpdir()
  g.getAssetsDir = () => tmpdir()
  g.ensureDir = async () => {}
  g.prisma = {
    video: {
      findUnique: async (args: { select?: Record<string, unknown> }) =>
        args?.select ? { subtitlesStyle: null } : VIDEO_ROW,
      update: async () => ({}),
    },
    scenarioVariant: { findFirst: async () => null, update: async () => ({}) },
    videoGenerationStep: {
      findFirst: async (args: { where: { stepKey?: string } }) =>
        (args.where.stepKey ? db.steps.get(args.where.stepKey) ?? null : null),
      findMany: async (args: { where?: { status?: { in?: string[] } } }) => {
        const statuses = args?.where?.status?.in
        const rows = [...db.steps.values()]
        return statuses ? rows.filter(r => statuses.includes(r.status)) : rows
      },
      updateMany: async (args: {
        where: { stepKey?: { in?: string[] }; status?: string }
        data: Record<string, unknown>
      }) => {
        const keys = args.where.stepKey?.in
        let count = 0
        for (const row of db.steps.values()) {
          if (keys && !keys.includes(row.stepKey)) continue
          if (args.where.status && row.status !== args.where.status) continue
          Object.assign(row, args.data)
          count += 1
        }
        return { count }
      },
    },
    videoAsset: {
      count: async () => 0,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => ({ id: 1 }),
      update: async () => ({ id: 1 }),
      deleteMany: async () => {
        db.assetDeleteMany += 1
        return { count: 0 }
      },
    },
  }
}

async function loadPipeline() {
  installGlobals()
  const mod = await import("../../../server/utils/video-pipeline")
  return mod.runVideoPipeline
}

beforeEach(() => {
  calls.voiceover.length = 0
  calls.assembly.length = 0
  db.assetDeleteMany = 0
  lipSync.status = "completed"
  lipSync.resyncedSceneCount = 2
  lipSync.clipPaths = ["c0_lipsync.mp4", "c1_lipsync.mp4", "c2_lipsync.mp4"]
  planHolder.plan = makePlan()
  seedSteps()
})

describe("runVideoPipeline: кэш озвучки после свежего lip-sync", () => {
  it("микс не берётся из кэша, если lip-sync подменил файлы клипов", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(7)

    // Шаг обязан отработать заново — и именно на lip-sync клипах этого прогона.
    expect(calls.voiceover).toHaveLength(1)
    expect(calls.voiceover[0]!.fromCache).toBe(false)
    expect(calls.voiceover[0]!.clipPaths).toEqual([
      "c0_lipsync.mp4", "c1_lipsync.mp4", "c2_lipsync.mp4",
    ])

    // В сборку уходит микс, сведённый по СВЕЖЕМУ таймлайну, а не по прошлому.
    const assembled = calls.assembly[0]!
    expect(assembled.voiceoverPath).not.toBe(STALE_MIX)
    expect(assembled.voiceoverPath).toBe(
      mixPathFor(["c0_lipsync_ext.mp4", "c1_lipsync_ext.mp4", "c2_lipsync_ext.mp4"]),
    )
    // И клипы в сборке — удлинённые копии свежих lip-sync файлов.
    expect(assembled.clipPaths).toEqual([
      "c0_lipsync_ext.mp4", "c1_lipsync_ext.mp4", "c2_lipsync_ext.mp4",
    ])
  })

  it("сброс не стирает деньги шага и не сносит уже синтезированные реплики", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(7)

    // Реплики сцен (VideoAsset type=voiceover) остаются — шаг переиспользует их
    // по ветке existingAsset и платит за TTS ноль. Снос означал бы повторный счёт.
    expect(db.assetDeleteMany).toBe(0)
    // actualCost прошлых попыток остаётся в отчёте: оператор ничего не перезапускал.
    expect(db.steps.get("voiceover_generation")!.actualCost).toBe(0.42)
  })

  it("lip-sync ничего не пересинхронизировал — кэш озвучки остаётся в силе", async () => {
    // Прогон, где шаг lip-sync поднял всё из снапшота: файлы клипов те же самые,
    // удлинённые озвучкой клипы прошлого прогона валидны.
    lipSync.resyncedSceneCount = 0
    lipSync.clipPaths = ["c0.mp4", "c1.mp4", "c2.mp4"]
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(7)

    expect(calls.voiceover[0]!.fromCache).toBe(true)
    expect(calls.assembly[0]!.voiceoverPath).toBe(STALE_MIX)
    expect(calls.assembly[0]!.clipPaths).toEqual(STALE_CLIP_PATHS)
    // Кэш не тронут: шаг остался completed со своим снапшотом.
    expect(db.steps.get("voiceover_generation")!.status).toBe("completed")
    expect(db.steps.get("voiceover_generation")!.outputSnapshot).not.toBeNull()
  })

  it("сбрасывается только озвучка — музыку из-за клипов переигрывать незачем", async () => {
    const runVideoPipeline = await loadPipeline()

    await runVideoPipeline(7)

    // Иначе каждый прогон с lip-sync заново оплачивал бы Mubert.
    expect(db.steps.get("music_generation")!.status).toBe("skipped")
  })
})

describe("политика инвалидации кэша по свежим клипам", () => {
  it("сбрасывается ровно шаг с клип-зависимым кэшем", () => {
    expect(stepsInvalidatedByFreshClips(true)).toEqual(["voiceover_generation"])
    expect(stepsInvalidatedByFreshClips(false)).toEqual([])
  })

  it("патч — тот же, что у rerunVideoStep, но без обнуления денег", () => {
    const patch = snapshotInvalidationPatch(STEP_RERUN_RESET_PATCH)
    expect(patch.outputSnapshot).toBeNull()
    expect(patch.status).toBe("pending")
    expect(patch.falRequestId).toBeNull()
    expect("actualCost" in patch).toBe(false)
    // Источник патча не мутируем — им сбрасывает шаги rerunVideoStep.
    expect(STEP_RERUN_RESET_PATCH.actualCost).toBeNull()
  })
})
