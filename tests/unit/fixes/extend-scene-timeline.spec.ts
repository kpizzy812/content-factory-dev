/**
 * Регрессия: политика extend_scene не должна ронять синхрон озвучки с картинкой.
 *
 * Дефект: старт реплики фиксировался ВНУТРИ цикла по videoPlan.scenes. Клипы
 * нарезаются в порядке `prompts.scenePrompts.scenes`, и этот порядок моделью
 * переставляется, поэтому сцена, идущая в плане раньше, может иметь клип с
 * бо́льшим индексом. Такая сцена проходила цикл первой и запоминала свой старт
 * ДО того, как более ранний по нарезке клип удлинялся под свою озвучку. В итоге
 * реплика уезжала вперёд ровно на величину удлинения соседнего клипа.
 *
 * Ожидание: стартовые времена считаются один раз ПОСЛЕ цикла, по финальным
 * длительностям клипов, и микс строится по этим же временам.
 *
 * DB-free: слой БД, TTS, ffmpeg-обёртки и storage замоканы, глобалы Nuxt подменены.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: vi.fn(async () => ({
    id: 42,
    attemptCount: 0,
    actualCost: 0,
    status: "pending",
    outputSnapshot: null,
  })),
  updateStep: vi.fn(async () => {}),
  appendStepLog: vi.fn(async () => {}),
  isStepCompleted: vi.fn(() => false),
  updateVideoStatus: vi.fn(async () => {}),
  falStepRequest: vi.fn(async () => {}),
}))

vi.mock("../../../server/utils/balance/cost-ledger", () => ({
  logStepCost: vi.fn(async () => {}),
}))

/** Длительность синтеза задаётся текстом реплики — сцены должны различаться. */
const VOICE_DURATIONS: Record<string, number> = {
  short: 3,
  long: 7,
}

vi.mock("../../../server/utils/tts", () => ({
  synthesizeSpeech: vi.fn(async (opts: { text: string; outputPath: string }) => ({
    audioPath: opts.outputPath,
    durationSec: VOICE_DURATIONS[opts.text] ?? 3,
    model: { id: "fal-ai/kokoro/russian", name: "kokoro", provider: "fal" },
    voiceId: "voice-1",
    costUsd: 0.01,
    remoteUrl: null,
    characters: opts.text.length,
  })),
  buildVoiceoverTrack: vi.fn(async (opts: {
    scenes: Array<{ sceneOrder: number; sceneStartSec: number; sceneDurationSec: number }>
    totalDurationSec: number
  }) => {
    mixCalls.scenes = opts.scenes.map(s => ({
      sceneOrder: s.sceneOrder,
      sceneStartSec: s.sceneStartSec,
      sceneDurationSec: s.sceneDurationSec,
    }))
    mixCalls.totalDurationSec = opts.totalDurationSec
    return { durationSec: opts.totalDurationSec }
  }),
  probeAudioDuration: vi.fn(async () => 3),
}))

/** Что уехало в микс — по стартам видно, на какой клип легла реплика. */
const mixCalls = vi.hoisted(() => ({
  scenes: [] as Array<{ sceneOrder: number; sceneStartSec: number; sceneDurationSec: number }>,
  totalDurationSec: 0,
}))

/** ffmpeg-обёртки: реальных вызовов нет, арифметика лимита повторяет render.ts. */
vi.mock("../../../server/utils/render", () => ({
  probeClipDurations: vi.fn(async (paths: string[]) => paths.map(() => 5)),
  probeSceneClipDurations: vi.fn(async (paths: string[]) =>
    paths.map(p => (p.trim().length === 0 ? null : 5))),
  adjustAudioTempo: vi.fn(async (_i: string, out: string) => ({ outputPath: out, durationSec: 4 })),
  trimAudio: vi.fn(async (_i: string, out: string) => ({ outputPath: out, durationSec: 4 })),
  extendVideoClip: vi.fn(async (_src: string, out: string, extraSec: number) => ({
    outputPath: out,
    durationSec: 5 + extraSec,
  })),
  planClipExtension: vi.fn((opts: {
    clipDurationSec: number
    voiceoverDurationSec: number
    gapSec?: number
  }) => {
    const gap = opts.gapSec ?? 0.1
    const needed = Math.max(0, opts.voiceoverDurationSec + gap - opts.clipDurationSec)
    // MAX_CLIP_EXTEND_RATIO=0.5, MAX_CLIP_EXTEND_SEC=5 (server/utils/render.ts).
    const limit = Math.min(opts.clipDurationSec * 0.5, 5)
    return {
      neededSec: Math.round(needed * 100) / 100,
      allowed: needed > 0 && needed <= limit,
      limitSec: Math.round(limit * 100) / 100,
    }
  }),
}))

vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: vi.fn(async () => ({ storageKey: "videos/7/asset.mp3" })),
}))

vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: vi.fn(() => "/api/files/asset.mp3"),
}))

const VIDEO_CONFIG = {
  voiceoverEnabled: true,
  voiceoverModelId: null,
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  // slow — чтобы ветка «замедлить короткую реплику» не вмешивалась в тайминги.
  voiceoverPacing: "slow" as const,
  voiceoverReconciliation: "extend_scene" as const,
  modelStrategy: "budget",
}

/**
 * План с переставленными сценами: в плане сначала сцена 2, потом сцена 1,
 * а клипы нарезаны в порядке [1, 2] — то есть клип сцены 1 идёт первым.
 */
function makePlan(texts: { scene1: string; scene2: string }) {
  return {
    mode: "story_driven",
    scenes: [
      { order: 2, durationSec: 5 },
      { order: 1, durationSec: 5 },
    ],
    voiceoverPlan: {
      enabled: true,
      lines: [
        { sceneOrder: 2, text: texts.scene2, emotion: "neutral" },
        { sceneOrder: 1, text: texts.scene1, emotion: "neutral" },
      ],
    },
  } as unknown as StoryDrivenVideoPlan
}

async function loadRunVoiceover() {
  const g = globalThis as Record<string, unknown>
  g.getAssetsDir = () => tmpdir()
  g.ensureDir = async () => {}
  g.prisma = {
    videoAsset: {
      findFirst: async () => null,
      create: async () => ({ id: 1 }),
      update: async () => ({ id: 1 }),
    },
  }
  const mod = await import("../../../server/utils/video-pipeline-steps")
  return mod.runVoiceoverGeneration
}

describe("runVoiceoverGeneration: extend_scene пересчитывает таймлайн после всех удлинений", () => {
  beforeEach(() => {
    mixCalls.scenes = []
    mixCalls.totalDurationSec = 0
  })

  it("удлинение клипа сцены сдвигает реплику сцены, которая в плане идёт раньше", async () => {
    const runVoiceoverGeneration = await loadRunVoiceover()
    // Сцена 1 (клип 0) требует удлинения 5s → 7.1s под реплику 7s.
    // Сцена 2 (клип 1) в плане идёт ПЕРВОЙ и раньше запоминала старт 5s.
    const plan = makePlan({ scene1: "long", scene2: "short" })

    const result = await runVoiceoverGeneration(
      7,
      ["c0.mp4", "c1.mp4"],
      VIDEO_CONFIG,
      plan,
      [1, 2],
    )

    const scene2 = mixCalls.scenes.find(s => s.sceneOrder === 2)!
    const scene1 = mixCalls.scenes.find(s => s.sceneOrder === 1)!
    expect(scene1.sceneStartSec).toBeCloseTo(0, 6)
    // Клип сцены 1 стал 7.1s — клип сцены 2 начинается там же, а не на 5s.
    expect(scene2.sceneStartSec).toBeCloseTo(7.1, 6)
    expect(scene2.sceneDurationSec).toBeCloseTo(5, 6)
    expect(scene1.sceneDurationSec).toBeCloseTo(7.1, 6)
    // Общая длина трека тоже с учётом удлинения.
    expect(mixCalls.totalDurationSec).toBeCloseTo(12.1, 6)
    expect(result.clipPaths).toEqual(["c0_ext.mp4", "c1.mp4"])
  })

  it("без удлинений раскладка прежняя — старт по порядку нарезки", async () => {
    const runVoiceoverGeneration = await loadRunVoiceover()
    const plan = makePlan({ scene1: "short", scene2: "short" })

    const result = await runVoiceoverGeneration(
      7,
      ["c0.mp4", "c1.mp4"],
      VIDEO_CONFIG,
      plan,
      [1, 2],
    )

    expect(mixCalls.scenes).toEqual([
      { sceneOrder: 2, sceneStartSec: 5, sceneDurationSec: 5 },
      { sceneOrder: 1, sceneStartSec: 0, sceneDurationSec: 5 },
    ])
    expect(result.clipPaths).toBeUndefined()
  })
})
