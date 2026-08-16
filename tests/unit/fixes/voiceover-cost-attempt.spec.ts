/**
 * Регрессия учёта денег за озвучку: попытка шага доезжает до cost-ledger.
 *
 * Дефект: voiceover_generation был единственным платным шагом, который звал
 * logStepCost без { attempt }. Дедуп ledger для attempt=1 ищет строку без учёта
 * номера попытки, поэтому rerun шага (реальная повторная оплата TTS у провайдера)
 * молча схлопывался с записью первого прогона — траты на самый дорогой по объёму
 * шаг занижались на 100% каждого перезапуска. Заодно actualCost перезаписывался
 * стоимостью последнего прогона вместо накопления.
 *
 * DB-free: слой БД, TTS, ffmpeg-обёртки и storage замоканы, глобалы Nuxt подменены.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

/** Шаг, который «уже отработал один раз»: вторая попытка + деньги первой. */
const stepState = vi.hoisted(() => ({ attemptCount: 1, actualCost: 0.2 }))

const dbCalls = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: vi.fn(async () => ({
    id: 42,
    attemptCount: stepState.attemptCount,
    actualCost: stepState.actualCost,
    status: "pending",
    outputSnapshot: null,
  })),
  updateStep: vi.fn(async (_id: number, data: Record<string, unknown>) => {
    dbCalls.updates.push(data)
  }),
  appendStepLog: vi.fn(async () => {}),
  isStepCompleted: vi.fn(() => false),
  updateVideoStatus: vi.fn(async () => {}),
  falStepRequest: vi.fn(async () => {}),
}))

const ledger = vi.hoisted(() => ({
  calls: [] as Array<{ stepKey: string; costUsd: number; options?: { attempt?: number } }>,
}))

vi.mock("../../../server/utils/balance/cost-ledger", () => ({
  logStepCost: vi.fn(async (
    _stepId: number,
    stepKey: string,
    _service: unknown,
    costUsd: number,
    _videoId: number,
    _modelId?: string | null,
    options?: { attempt?: number },
  ) => {
    ledger.calls.push({ stepKey, costUsd, options })
  }),
}))

/** Синтез не ходит в сеть: цена реплики фиксирована, длительность влезает в клип. */
vi.mock("../../../server/utils/tts", () => ({
  synthesizeSpeech: vi.fn(async (opts: { outputPath: string }) => ({
    audioPath: opts.outputPath,
    durationSec: 4,
    model: { id: "fal-ai/kokoro/russian", name: "kokoro", provider: "fal" },
    voiceId: "voice-1",
    costUsd: 0.1,
    remoteUrl: null,
    characters: 10,
  })),
  buildVoiceoverTrack: vi.fn(async () => ({ durationSec: 5 })),
  probeAudioDuration: vi.fn(async () => 4),
}))

/** ffmpeg-обёртки: реальных вызовов быть не должно. */
vi.mock("../../../server/utils/render", () => ({
  // Нормализация под concat: в тесте файлов нет, отдаём пути как есть.
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeClipDurations: vi.fn(async (paths: string[]) => paths.map(() => 5)),
  probeSceneClipDurations: vi.fn(async (paths: string[]) =>
    paths.map(p => (p.trim().length === 0 ? null : 5))),
  adjustAudioTempo: vi.fn(async () => ({ outputPath: "sped.mp3", durationSec: 4 })),
  trimAudio: vi.fn(async () => ({ outputPath: "trim.mp3", durationSec: 4 })),
  extendVideoClip: vi.fn(async () => ({ outputPath: "ext.mp4", durationSec: 6 })),
  planClipExtension: vi.fn(() => ({ allowed: false, neededSec: 0, limitSec: 0 })),
}))

vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: vi.fn(async () => ({ storageKey: "videos/1/voiceover.mp3" })),
}))

vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: vi.fn(() => "/api/files/voiceover.mp3"),
}))

const VIDEO_CONFIG = {
  voiceoverEnabled: true,
  voiceoverModelId: null,
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as const,
  voiceoverReconciliation: "compress_audio" as const,
  modelStrategy: "budget",
}

function makePlan(lineText: string) {
  return {
    mode: "story_driven",
    scenes: [{ order: 1, durationSec: 5 }],
    voiceoverPlan: {
      enabled: true,
      lines: [{ sceneOrder: 1, text: lineText, emotion: "neutral" }],
    },
  } as unknown as StoryDrivenVideoPlan
}

async function loadRunVoiceover() {
  // Автоимпорты Nuxt: в чистом vitest их нет — ставим фейки до импорта модуля.
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

describe("runVoiceoverGeneration: повторная озвучка попадает в ledger", () => {
  beforeEach(() => {
    ledger.calls.length = 0
    dbCalls.updates.length = 0
    stepState.attemptCount = 1
    stepState.actualCost = 0.2
  })

  it("вторая попытка пишет cost с attempt=2 и накапливает actualCost", async () => {
    const runVoiceoverGeneration = await loadRunVoiceover()

    await runVoiceoverGeneration(7, ["a.mp4"], VIDEO_CONFIG, makePlan("Привет"))

    expect(ledger.calls).toHaveLength(1)
    expect(ledger.calls[0]!.stepKey).toBe("voiceover_generation")
    expect(ledger.calls[0]!.costUsd).toBeCloseTo(0.1, 6)
    // Без attempt дедуп нашёл бы строку первого прогона и списание потерялось бы.
    expect(ledger.calls[0]!.options?.attempt).toBe(2)

    // actualCost = деньги прошлых попыток + этот прогон, а не только последний.
    const finished = dbCalls.updates.find(u => u.status === "completed")!
    expect(finished.actualCost).toBeCloseTo(0.3, 6)
    // Номер попытки, ушедший в ledger, совпадает с тем, что записан в шаг.
    expect(dbCalls.updates.find(u => u.status === "running")!.attemptCount).toBe(2)
  })

  it("ветка partial (нет озвученных сцен) тоже передаёт попытку и не обнуляет actualCost", async () => {
    const runVoiceoverGeneration = await loadRunVoiceover()

    await runVoiceoverGeneration(7, ["a.mp4"], VIDEO_CONFIG, makePlan("   "))

    expect(ledger.calls).toHaveLength(1)
    expect(ledger.calls[0]!.options?.attempt).toBe(2)
    // Прогон ничего не синтезировал — потраченное раньше стирать нельзя.
    expect(dbCalls.updates.find(u => u.status === "completed")!.actualCost).toBeCloseTo(0.2, 6)
  })

  it("первый прогон остаётся attempt=1 — историческая строка ledger не дублируется", async () => {
    stepState.attemptCount = 0
    stepState.actualCost = null as unknown as number
    const runVoiceoverGeneration = await loadRunVoiceover()

    await runVoiceoverGeneration(7, ["a.mp4"], VIDEO_CONFIG, makePlan("Привет"))

    expect(ledger.calls[0]!.options?.attempt).toBe(1)
    expect(dbCalls.updates.find(u => u.status === "completed")!.actualCost).toBeCloseTo(0.1, 6)
  })
})
