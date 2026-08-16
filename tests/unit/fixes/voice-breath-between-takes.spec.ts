/**
 * Регрессия: между тейками есть вдох, а реплика не налезает на соседнюю.
 *
 * Жалобы на ролик 24 (68.9 с):
 *  — «0:17 новая реплика налезает на старую, слишком резко стартует»;
 *  — «43 секунда наложения фраз, тейк не был закончен и поверх она говорит»;
 *  — «она говорит мини-фразу, а пауза как будто закончился тейк».
 *
 * Замер: реплика ставилась ровно на стык клипов и тянулась до конца сцены минус
 * 0.1 с, а весь запас в секунду копился в хвосте. Плюс сборка склеивает
 * НОРМАЛИЗОВАННЫЕ клипы, которые короче исходных на 0.02-0.06 с, — ошибка
 * копилась и к восьмой сцене реплика заезжала в следующую на 0.18 с.
 *
 * Правило: реплика живёт внутри [начало сцены + вдох, конец сцены − хвост].
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const h = vi.hoisted(() => ({
  step: { id: 9, actualCost: 0, attemptCount: 0, outputSnapshot: null as unknown },
  durationByPath: new Map<string, number>(),
  mix: [] as Array<{ sceneOrder: number; sceneStartSec: number; sceneDurationSec: number }>,
  ttsDurationSec: 4,
  tempoCalls: [] as number[],
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async () => undefined,
  appendStepLog: async () => undefined,
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/render", () => ({
  // Нормализация под concat: в тесте файлов нет, отдаём пути как есть.
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeSceneClipDurations: async (paths: string[]) =>
    paths.map(p => (p.trim().length === 0 ? null : h.durationByPath.get(p) ?? 5)),
  probeMediaDuration: async (p: string) => h.durationByPath.get(p) ?? null,
  probeClipDurations: async (paths: string[]) => paths.map(p => h.durationByPath.get(p) ?? 5),
  adjustAudioTempo: async (_i: string, o: string, speed: number) => {
    h.tempoCalls.push(speed)
    return { outputPath: o, durationSec: h.ttsDurationSec / speed }
  },
  trimAudio: async (_i: string, o: string, target: number) => ({ outputPath: o, durationSec: target }),
  extendVideoClip: async (src: string) => ({ outputPath: `${src}_ext.mp4`, durationSec: 12 }),
  planClipExtension: () => ({ allowed: false, neededSec: 0, limitSec: 0 }),
}))

vi.mock("../../../server/utils/tts", () => ({
  synthesizeSpeech: async (opts: { outputPath: string }) => ({
    audioPath: opts.outputPath,
    durationSec: h.ttsDurationSec,
    model: { id: "fish", name: "fish", provider: "fish" },
    voiceId: "v1",
    costUsd: 0,
    remoteUrl: null,
    characters: 20,
  }),
  buildVoiceoverTrack: async (opts: { scenes: typeof h.mix }) => {
    h.mix = opts.scenes.map(s => ({
      sceneOrder: s.sceneOrder,
      sceneStartSec: s.sceneStartSec,
      sceneDurationSec: s.sceneDurationSec,
    }))
    return { durationSec: 30 }
  },
  probeAudioDuration: async () => h.ttsDurationSec,
}))

vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: async (_p: string, storageKey: string) => ({ storageKey, storageProvider: "local" }),
}))
vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: () => "/api/files/x.mp3",
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: async () => undefined }))

function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.getAssetsDir = () => tmpdir()
  g.ensureDir = async () => {}
  g.logAgent = async () => {}
  g.prisma = {
    videoAsset: { findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
  }
}

const VOICE_CONFIG = {
  voiceoverEnabled: true,
  voiceoverModelId: null,
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as const,
  voiceoverReconciliation: "compress_audio" as const,
  modelStrategy: "budget",
}

function plan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [1, 2].map(order => ({ order, durationSec: 10 })),
    voiceoverPlan: {
      enabled: true,
      lines: [1, 2].map(sceneOrder => ({ sceneOrder, text: `реплика ${sceneOrder}`, emotion: "neutral" })),
    },
  } as unknown as StoryDrivenVideoPlan
}

async function loadSteps() {
  installGlobals()
  return await import("../../../server/utils/video-pipeline-steps")
}

beforeEach(() => {
  h.step = { id: 9, actualCost: 0, attemptCount: 0, outputSnapshot: null }
  h.durationByPath.clear()
  h.mix = []
  h.tempoCalls.length = 0
  h.ttsDurationSec = 4
})

describe("runVoiceoverGeneration: реплика не встык, а с вдохом", () => {
  it("реплика стартует не на самом стыке клипов", async () => {
    const steps = await loadSteps()
    h.durationByPath.set("c0.mp4", 6)
    h.durationByPath.set("c1.mp4", 6)

    const { VOICE_LEAD_IN_SEC } = await import("~~/shared/types/video-runtime")
    await steps.runVoiceoverGeneration(24, ["c0.mp4", "c1.mp4"], VOICE_CONFIG, plan(), [1, 2])

    expect(h.mix[0]!.sceneStartSec).toBe(VOICE_LEAD_IN_SEC)
    expect(h.mix[1]!.sceneStartSec).toBe(6 + VOICE_LEAD_IN_SEC)
  })

  it("реплика обязана закончиться до конца сцены с запасом на хвост", async () => {
    const steps = await loadSteps()
    const { VOICE_LEAD_IN_SEC, VOICE_TAIL_SEC } = await import("~~/shared/types/video-runtime")
    h.durationByPath.set("c0.mp4", 6)
    h.durationByPath.set("c1.mp4", 6)
    // Речь длиннее, чем помещается между вдохом и хвостом — её ускоряют.
    h.ttsDurationSec = 6

    await steps.runVoiceoverGeneration(24, ["c0.mp4", "c1.mp4"], VOICE_CONFIG, plan(), [1, 2])

    const allowed = 6 - VOICE_LEAD_IN_SEC - VOICE_TAIL_SEC
    expect(h.tempoCalls.length).toBeGreaterThan(0)
    expect(6 / h.tempoCalls[0]!).toBeLessThanOrEqual(allowed + 0.001)
  })

  it("короткая реплика ускорения не требует", async () => {
    const steps = await loadSteps()
    h.durationByPath.set("c0.mp4", 6)
    h.durationByPath.set("c1.mp4", 6)
    h.ttsDurationSec = 3

    await steps.runVoiceoverGeneration(24, ["c0.mp4", "c1.mp4"], VOICE_CONFIG, plan(), [1, 2])

    expect(h.tempoCalls.filter(s => s > 1)).toHaveLength(0)
  })
})
