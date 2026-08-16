/**
 * Регрессия: на маршруте «монтаж от звука» (`editPipeline: true`) блок сведения
 * `runVoiceoverGeneration` (extend_scene/trim_audio/sped_up/slowed_down) обязан
 * молчать — кадр и так нарезан по речи, а правка звука на этом маршруте
 * запрещена (spec §8, задача 10). На старом маршруте (`editPipeline: false`)
 * поведение обязано остаться прежним.
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
}))

vi.mock("../../../server/utils/balance/cost-ledger", () => ({
  logStepCost: vi.fn(async () => {}),
}))

/** Реплика длиннее сцены (5s слот, maxAllowedSec ~4.5s после вдоха/хвоста) — без гейта ушла бы в extend/trim/sped. */
vi.mock("../../../server/utils/tts", () => ({
  synthesizeSpeech: vi.fn(async (opts: { text: string; outputPath: string }) => ({
    audioPath: opts.outputPath,
    durationSec: 7,
    model: { id: "fal-ai/kokoro/russian", name: "kokoro", provider: "fal" },
    voiceId: "voice-1",
    costUsd: 0.01,
    remoteUrl: null,
    characters: opts.text.length,
  })),
  buildVoiceoverTrack: vi.fn(async (opts: { totalDurationSec: number }) => ({ durationSec: opts.totalDurationSec })),
  probeAudioDuration: vi.fn(async () => 7),
}))

const renderMocks = vi.hoisted(() => ({
  extendVideoClip: vi.fn(async (_src: string, out: string, extraSec: number) => ({ outputPath: out, durationSec: 5 + extraSec })),
  trimAudio: vi.fn(async (_i: string, out: string) => ({ outputPath: out, durationSec: 4 })),
  adjustAudioTempo: vi.fn(async (_i: string, out: string) => ({ outputPath: out, durationSec: 4 })),
}))

vi.mock("../../../server/utils/render", () => ({
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeClipDurations: vi.fn(async (paths: string[]) => paths.map(() => 5)),
  probeSceneClipDurations: vi.fn(async (paths: string[]) =>
    paths.map(p => (p.trim().length === 0 ? null : 5))),
  adjustAudioTempo: renderMocks.adjustAudioTempo,
  trimAudio: renderMocks.trimAudio,
  extendVideoClip: renderMocks.extendVideoClip,
  planClipExtension: vi.fn(() => ({ neededSec: 2.1, allowed: true, limitSec: 5 })),
}))

vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: vi.fn(async () => ({ storageKey: "videos/9/asset.mp3" })),
}))

vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: vi.fn(() => "/api/files/asset.mp3"),
}))

function makePlan() {
  return {
    mode: "story_driven",
    scenes: [{ order: 1, durationSec: 5 }],
    voiceoverPlan: {
      enabled: true,
      lines: [{ sceneOrder: 1, text: "long", emotion: "neutral" }],
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

const BASE_CONFIG = {
  voiceoverEnabled: true,
  voiceoverModelId: null,
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "slow" as const,
  voiceoverReconciliation: "extend_scene" as const,
  modelStrategy: "budget",
}

describe("runVoiceoverGeneration: сведение длины отключается по маршруту (shouldReconcileVoiceover)", () => {
  beforeEach(() => {
    renderMocks.extendVideoClip.mockClear()
    renderMocks.trimAudio.mockClear()
    renderMocks.adjustAudioTempo.mockClear()
  })

  it("editPipeline: true — сведение не трогает файлы, reconciliation остаётся none", async () => {
    const runVoiceoverGeneration = await loadRunVoiceover()

    const result = await runVoiceoverGeneration(
      9,
      ["c0.mp4"],
      { ...BASE_CONFIG, editPipeline: true },
      makePlan(),
      [1],
    )

    expect(renderMocks.extendVideoClip).not.toHaveBeenCalled()
    expect(renderMocks.trimAudio).not.toHaveBeenCalled()
    expect(renderMocks.adjustAudioTempo).not.toHaveBeenCalled()
    expect(result.sceneResults[0]).toMatchObject({ reconciliation: "none", durationSec: 7 })
    expect(result.clipPaths).toBeUndefined()
  })

  it("editPipeline: false — сведение работает как прежде (extend_scene удлиняет клип)", async () => {
    const runVoiceoverGeneration = await loadRunVoiceover()

    const result = await runVoiceoverGeneration(
      9,
      ["c0.mp4"],
      { ...BASE_CONFIG, editPipeline: false },
      makePlan(),
      [1],
    )

    expect(renderMocks.extendVideoClip).toHaveBeenCalledTimes(1)
    expect(result.sceneResults[0]).toMatchObject({ reconciliation: "scene_extended" })
  })

  it("editPipeline не передан — по умолчанию сведение как на старом маршруте", async () => {
    const runVoiceoverGeneration = await loadRunVoiceover()

    const result = await runVoiceoverGeneration(
      9,
      ["c0.mp4"],
      { ...BASE_CONFIG },
      makePlan(),
      [1],
    )

    expect(renderMocks.extendVideoClip).toHaveBeenCalledTimes(1)
    expect(result.sceneResults[0]).toMatchObject({ reconciliation: "scene_extended" })
  })
})
