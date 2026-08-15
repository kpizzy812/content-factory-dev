/**
 * Регрессия: озвучка и картинка живут на ОДНОМ таймлайне.
 *
 * Дефекты ролика 23:
 *  V1 — список клипов идёт по сценам, и у сцены без своего клипа ячейка пуста.
 *       `probeClipDurations` мерил её как файл, ffprobe падал, и пустота молча
 *       превращалась в 5 секунд: старт каждой следующей реплики уезжал вперёд.
 *  V2 — отрезки, на которых глушится звук клипов, оркестратор считал по ПЛАНУ
 *       (`durationSec: 10` у всех девяти сцен), а не по фактическому миксу.
 *       Шаг озвучки знает настоящие старты — он их и обязан отдать.
 *
 * DB-free: TTS, ffmpeg-обёртки и storage замоканы.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const h = vi.hoisted(() => ({
  step: { id: 9, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  /** Длительности «файлов» на диске. Пути, которых здесь нет, не измеряются. */
  durationByPath: new Map<string, number>(),
  probeCalls: [] as string[],
  mix: [] as Array<{ sceneOrder: number; sceneStartSec: number; sceneDurationSec: number }>,
  ttsDurationSec: 4,
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async () => undefined,
  appendStepLog: async (_id: number, line: string) => { h.logs.push(line) },
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/render", () => ({
  probeMediaDuration: async (path: string) => {
    h.probeCalls.push(path)
    return h.durationByPath.get(path) ?? null
  },
  // Старый массовый замер: любая неудача ffprobe молча превращается в 5 секунд —
  // ровно то поведение, из-за которого пустая ячейка «весила» пять секунд.
  probeClipDurations: async (paths: string[]) => {
    h.probeCalls.push(...paths)
    return paths.map(p => h.durationByPath.get(p) ?? 5)
  },
  // Замер по ячейкам сцен — контракт проверен отдельно
  // (probe-scene-clip-durations.spec.ts), здесь он стоит заглушкой без ffprobe.
  probeSceneClipDurations: async (paths: string[]) => {
    const measured: Array<number | null> = []
    for (const path of paths) {
      if (path.trim().length === 0) {
        measured.push(null)
        continue
      }
      h.probeCalls.push(path)
      measured.push(h.durationByPath.get(path) ?? 5)
    }
    return measured
  },
  adjustAudioTempo: async (_i: string, o: string) => ({ outputPath: o, durationSec: h.ttsDurationSec }),
  trimAudio: async (_i: string, o: string) => ({ outputPath: o, durationSec: h.ttsDurationSec }),
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
    videoAsset: {
      findFirst: async () => null,
      create: async () => ({ id: "a" }),
      update: async () => ({ id: "a" }),
    },
  }
}

const VOICE_CONFIG = {
  voiceoverEnabled: true,
  voiceoverModelId: null,
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "slow" as const,
  voiceoverReconciliation: "compress_audio" as const,
  modelStrategy: "budget",
}

/** Три сцены с закадровыми репликами. */
function plan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [1, 2, 3].map(order => ({ order, durationSec: 10, subtitleCopy: "", subtitlePlacement: null })),
    voiceoverPlan: {
      enabled: true,
      lines: [1, 2, 3].map(sceneOrder => ({ sceneOrder, text: `реплика ${sceneOrder}`, emotion: "neutral" })),
    },
  } as unknown as StoryDrivenVideoPlan
}

async function loadSteps() {
  installGlobals()
  return await import("../../../server/utils/video-pipeline-steps")
}

beforeEach(() => {
  h.step = { id: 9, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.durationByPath.clear()
  h.probeCalls.length = 0
  h.mix = []
  h.ttsDurationSec = 4
})

describe("runVoiceoverGeneration: пустая ячейка — это отсутствие клипа", () => {
  it("сцена без клипа не занимает времени на таймлайне и не сдвигает следующие", async () => {
    const steps = await loadSteps()
    h.durationByPath.set("c0.mp4", 6)
    h.durationByPath.set("c2.mp4", 7)

    await steps.runVoiceoverGeneration(23, ["c0.mp4", "", "c2.mp4"], VOICE_CONFIG, plan(), [1, 2, 3])

    // Сцена 2 клипа не получила → её нет в миксе, а сцена 3 стартует сразу
    // после первого клипа (6 с), а не после выдуманных пяти секунд паузы.
    expect(h.mix).toEqual([
      { sceneOrder: 1, sceneStartSec: 0, sceneDurationSec: 6 },
      { sceneOrder: 3, sceneStartSec: 6, sceneDurationSec: 7 },
    ])
  })

  it("пустую ячейку даже не пытаемся измерить", async () => {
    const steps = await loadSteps()
    h.durationByPath.set("c0.mp4", 6)
    h.durationByPath.set("c2.mp4", 7)

    await steps.runVoiceoverGeneration(23, ["c0.mp4", "", "c2.mp4"], VOICE_CONFIG, plan(), [1, 2, 3])

    expect(h.probeCalls).toContain("c0.mp4")
    expect(h.probeCalls).not.toContain("")
  })
})

describe("runVoiceoverGeneration: отрезки речи считает сам шаг", () => {
  it("возвращает интервалы по фактическому миксу, а не по плановым длительностям", async () => {
    const steps = await loadSteps()
    h.durationByPath.set("c0.mp4", 6)
    h.durationByPath.set("c1.mp4", 5)
    h.durationByPath.set("c2.mp4", 7)

    const result = await steps.runVoiceoverGeneration(
      23, ["c0.mp4", "c1.mp4", "c2.mp4"], VOICE_CONFIG, plan(), [1, 2, 3],
    )

    // План говорит «по 10 секунд на сцену», факт — 6/5/7. Речь по 4 секунды.
    expect(result.voicedIntervals).toEqual([
      { startSec: 0, endSec: 4 },
      { startSec: 6, endSec: 10 },
      { startSec: 11, endSec: 15 },
    ])
  })

  it("реплика не вылезает за свой клип: интервал обрезается длиной сцены", async () => {
    const steps = await loadSteps()
    h.durationByPath.set("c0.mp4", 3)
    h.ttsDurationSec = 9

    const shortPlan = {
      mode: "story_driven",
      scenes: [{ order: 1, durationSec: 10 }],
      voiceoverPlan: { enabled: true, lines: [{ sceneOrder: 1, text: "длинная реплика", emotion: "neutral" }] },
    } as unknown as StoryDrivenVideoPlan

    const result = await steps.runVoiceoverGeneration(23, ["c0.mp4"], VOICE_CONFIG, shortPlan, [1])

    expect(result.voicedIntervals).toEqual([{ startSec: 0, endSec: 3 }])
  })
})
