/**
 * Реплика длиннее потолка lip-sync модели дробится на части, и КАЖДАЯ часть
 * получает свой вызов провайдера (spec §5.3, дефект ролика 30).
 *
 * До правки `planSegmentCut` резал из трека окно `[начало сцены, +потолок]` —
 * то есть ПРЕФИКС. Сцена 9 ролика 30 идёт 79.57-90.93 (11.36с) при потолке 10с:
 * последние 1.46с речи шли без синхронизации вовсе, а это был призыв к действию,
 * самое важное место ролика. Ускорять звук на этом маршруте нельзя (§8 — трек
 * эталон таймлайна), значит остаётся ровно одно: дробить реплику и платить за
 * вторую часть.
 *
 * Что здесь закреплено:
 *  - длинная сцена уходит в модель ДВУМЯ вызовами, рез приходится на самую
 *    длинную паузу внутри реплики (§5.3 п.1), каждая часть ≤ потолка;
 *  - части покрывают реплику ЦЕЛИКОМ — непокрытого хвоста не остаётся;
 *  - сцена короче потолка идёт ОДНИМ вызовом и с тем же именем файла, что и до
 *    правки (`scene_N_lipsync.mp4`) — старый маршрут не задет;
 *  - повторный прогон не оплачивает уже сделанные части (ключ считается НА
 *    ЧАСТЬ, а не на сцену);
 *  - частичный успех отдаёт то, что вышло, а не роняет сцену;
 *  - снапшот старого формата (одна запись на сцену, без `parts`) читается и
 *    переиспользуется.
 *
 * DB-free: prisma, TTS, lip-sync, storage, presenter-source-selector и
 * fluent-ffmpeg (вырезка куска трека) замоканы. Ни одного платного вызова.
 * Приём мокирования — тот же, что у `lip-sync-duplicate-order-track.spec.ts`.
 */

import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runLipSyncStep } from "../../../server/utils/lip-sync-runner"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const h = vi.hoisted(() => ({
  assetsDir: "",
  step: { id: 707, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  durationByPath: new Map<string, number>(),
  ffmpegRuns: [] as Array<{ input: string; output: string; outputOptions: string[] }>,
  snapshots: [] as Array<Record<string, unknown>>,
  createdClipAssets: [] as Array<Record<string, unknown>>,
  synthesizeSpeech: vi.fn(),
  runLipSync: vi.fn(),
  probeMediaDuration: vi.fn(),
  adjustAudioTempo: vi.fn(),
  reservePresenterSourceClip: vi.fn(),
  uploadLocalAsset: vi.fn(),
}))

vi.mock("fluent-ffmpeg", () => {
  const ffmpeg = (input: string) => {
    let output = ""
    let outputOptions: string[] = []
    const handlers = new Map<string, (arg?: unknown) => void>()
    const command: Record<string, unknown> = {
      inputOptions: () => command,
      audioFilters: () => command,
      outputOptions: (options: string[]) => { outputOptions = options; return command },
      output: (path: string) => { output = path; return command },
      on: (event: string, cb: (arg?: unknown) => void) => { handlers.set(event, cb); return command },
      run: () => {
        void (async () => {
          const durationIndex = outputOptions.indexOf("-t")
          const durationSec = durationIndex >= 0 ? Number(outputOptions[durationIndex + 1]) : 0
          await writeFile(output, "segment")
          h.durationByPath.set(output, durationSec)
          h.ffmpegRuns.push({ input, output, outputOptions })
          handlers.get("end")?.()
        })()
      },
    }
    return command
  }
  return { default: ffmpeg }
})

vi.mock("../../../server/utils/prisma", () => ({
  prisma: {
    videoAsset: {
      findFirst: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        h.createdClipAssets.push(args.data)
        return { id: "new" }
      },
      update: async () => ({}),
    },
  },
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async (_id: number, data: Record<string, unknown>) => {
    if (data.outputSnapshot) h.snapshots.push(data.outputSnapshot as Record<string, unknown>)
  },
  appendStepLog: async (_id: number, line: string) => { h.logs.push(line) },
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/tts", () => ({ synthesizeSpeech: h.synthesizeSpeech }))
vi.mock("../../../server/utils/media-provider/lip-sync", () => ({ runLipSync: h.runLipSync }))
vi.mock("../../../server/utils/render", () => ({
  probeMediaDuration: h.probeMediaDuration,
  adjustAudioTempo: h.adjustAudioTempo,
}))
vi.mock("../../../server/utils/presenter-source-selector", () => ({
  reservePresenterSourceClip: h.reservePresenterSourceClip,
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: async () => undefined }))
vi.mock("../../../server/utils/storage-paths", () => ({ getAssetsDirFor: () => h.assetsDir }))
vi.mock("../../../server/utils/storage", () => ({
  getStorageDriver: () => ({ downloadToFile: async (_k: string, path: string) => { await writeFile(path, "src") } }),
}))
vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: (...args: unknown[]) => h.uploadLocalAsset(...args),
}))
vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: () => "/api/files/lipsync.mp4",
}))
vi.mock("../../../server/utils/video-helpers", () => ({ downloadFile: async () => undefined }))

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-long-scene-split")
h.assetsDir = ASSETS_DIR

const TRACK_PATH = join(ASSETS_DIR, "voiceover_track.mp3")

const VIDEO_CONFIG = {
  lipSyncEnabled: true,
  lipSyncModelId: null as string | null,
  lipSyncCharacterId: "character-1",
  voiceoverModelId: null as string | null,
  voiceoverVoiceId: null as string | null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as const,
}

/** Сцена 9 ролика 30 — те самые числа. */
const SCENE_START = 79.57
const SCENE_END = 90.93
/** Пауза внутри реплики, по которой §5.3 п.1 велит резать. */
const PAUSE_START = 85
const PAUSE_END = 85.6

function presenterOnlyPlan(orders: number[]): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: orders.map((order, index) => ({
      order,
      spokenLine: `Реплика сцены на позиции ${index} (order=${order})`,
      durationSec: 5,
    })),
    totalDurationSec: 0,
  } as unknown as StoryDrivenVideoPlan
}

/** Слова, расставленные встык, с одной явной паузой посередине реплики. */
function wordsWithPause(startSec: number, endSec: number, pauseStart: number, pauseEnd: number) {
  const words: Array<{ text: string; startSec: number; endSec: number; matched: boolean }> = []
  // Слова делят отрезок РОВНО, без остатка: иначе хвостовой зазор стал бы
  // второй паузой, и тест проверял бы не тот рез, что задуман.
  const push = (from: number, to: number) => {
    const count = Math.max(1, Math.round((to - from) / 0.4))
    const step = (to - from) / count
    for (let index = 0; index < count; index += 1) {
      words.push({ text: "сл", startSec: from + index * step, endSec: from + (index + 1) * step, matched: true })
    }
  }
  push(startSec, pauseStart)
  push(pauseEnd, endSec)
  return words
}

function longScene(order: number) {
  return {
    order,
    startSec: SCENE_START,
    endSec: SCENE_END,
    words: wordsWithPause(SCENE_START, SCENE_END, PAUSE_START, PAUSE_END),
  }
}

function shortScene(order: number, startSec: number, endSec: number) {
  return {
    order,
    startSec,
    endSec,
    words: wordsWithPause(startSec, endSec, startSec + 1, startSec + 1.5),
  }
}

function audioFirstInput(scenes: Array<ReturnType<typeof longScene>>, trackDurationSec: number) {
  return {
    trackPath: TRACK_PATH,
    trackDurationSec,
    trackFingerprint: "track-v1",
    fps: 30,
    scenes,
  }
}

/** Длительность куска (`-t`), которую фейковый ffmpeg реально получил. */
function cutDurations(): number[] {
  return h.ffmpegRuns.map((run) => {
    const idx = run.outputOptions.indexOf("-t")
    return idx >= 0 ? Number(run.outputOptions[idx + 1]) : NaN
  })
}

beforeEach(async () => {
  await rm(ASSETS_DIR, { recursive: true, force: true })
  await mkdir(ASSETS_DIR, { recursive: true })
  await writeFile(TRACK_PATH, "track")

  h.step = { id: 707, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.durationByPath.clear()
  h.ffmpegRuns.length = 0
  h.snapshots.length = 0
  h.createdClipAssets.length = 0

  h.synthesizeSpeech.mockReset()
  h.synthesizeSpeech.mockImplementation(async (args: { outputPath: string }) => {
    await writeFile(args.outputPath, "tts")
    return { costUsd: 0.002 }
  })

  h.runLipSync.mockReset()
  h.runLipSync.mockImplementation(async (req: { outputPath: string }) => {
    await writeFile(req.outputPath, "video")
    return { costUsd: 0.07, provider: "replicate", outputPath: req.outputPath }
  })

  h.probeMediaDuration.mockReset()
  h.probeMediaDuration.mockImplementation(async (path: string) => {
    const known = h.durationByPath.get(path)
    if (known !== undefined) return known
    return 5
  })

  h.adjustAudioTempo.mockReset()

  h.reservePresenterSourceClip.mockReset()
  h.reservePresenterSourceClip.mockResolvedValue({
    id: "frag-1",
    name: "frag.mp4",
    fileUrl: "https://storage/frag.mp4",
    storageKey: "presenter/frag.mp4",
    durationSec: 5,
  })

  h.uploadLocalAsset.mockReset()
  h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => ({
    storageKey, storageProvider: "local", storageBucket: null,
  }))
})

describe("runLipSyncStep: длинная реплика дробится и синхронизируется целиком", () => {
  it("сцена 11.36с при потолке 10с уходит в модель ДВУМЯ частями по паузе, покрывая реплику целиком", async () => {
    const result = await runLipSyncStep({
      videoId: 30,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([9]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([longScene(9)], 95),
    })

    // Два платных вызова — по одному на часть. До правки был один.
    expect(h.runLipSync).toHaveBeenCalledTimes(2)
    expect(h.ffmpegRuns).toHaveLength(2)

    const durations = cutDurations()
    // Каждая часть укладывается в потолок модели.
    for (const duration of durations) expect(duration).toBeLessThanOrEqual(10 + 1e-6)
    // И вместе они покрывают реплику целиком: непокрытого хвоста нет.
    const total = durations.reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(90.9333 - 79.5667, 2)

    // Рез пришёлся на паузу (§5.3 п.1), а не на потолок модели.
    expect(durations[0]).toBeCloseTo(85.3 - 79.5667, 2)

    const scene = result.scenes?.[0]
    expect(scene).toBeDefined()
    expect(scene!.parts).toHaveLength(2)
    expect(scene!.parts![0]!.outputPath).toBe(join(ASSETS_DIR, "scene_0_lipsync.mp4"))
    expect(scene!.parts![1]!.outputPath).toBe(join(ASSETS_DIR, "scene_0_part1_lipsync.mp4"))
    // Интервалы частей идут по возрастанию и стыкуются встык.
    expect(scene!.parts![0]!.endSec).toBeCloseTo(scene!.parts![1]!.startSec, 6)
    // Ключ переиспользования считается НА ЧАСТЬ: у двух частей он разный.
    expect(scene!.parts![0]!.reuseKey).not.toBe(scene!.parts![1]!.reuseKey)

    // Счётчики — НА СЦЕНУ, а не на часть: по ним оркестратор решает, ронять ли
    // ролик и доверять ли путям клипов из кэша озвучки.
    expect(result.syncedSceneCount).toBe(1)
    expect(result.resyncedSceneCount).toBe(1)

    // Ассет клипа — РОВНО ОДИН на сцену: `order` у VideoAsset(type=clip) это
    // индекс сцены, и вторая строка с тем же order дала бы сборке призрачный
    // лишний клип.
    expect(h.createdClipAssets).toHaveLength(1)
    expect(h.createdClipAssets[0]!.order).toBe(0)
  })

  it("сцена короче потолка идёт ОДНИМ вызовом с прежним именем файла", async () => {
    const result = await runLipSyncStep({
      videoId: 31,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([1]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([shortScene(1, 0, 8)], 8),
    })

    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(result.clipPaths[0]).toBe(join(ASSETS_DIR, "scene_0_lipsync.mp4"))
    // Разбиения не было — списка частей у записи нет вовсе (снапшот прежней формы).
    expect(result.scenes?.[0]?.parts).toBeUndefined()
  })

  it("повторный прогон не оплачивает уже сделанные части", async () => {
    const first = await runLipSyncStep({
      videoId: 32,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([9]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([longScene(9)], 95),
    })
    expect(h.runLipSync).toHaveBeenCalledTimes(2)

    // Снапшот прошлого прогона — ровно то, что шаг записал сам.
    h.step = { id: 707, attemptCount: 1, actualCost: 0.14, outputSnapshot: first as unknown }
    h.runLipSync.mockClear()

    const second = await runLipSyncStep({
      videoId: 32,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([9]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([longScene(9)], 95),
    })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(second.totalCostUsd).toBe(0)
    expect(second.syncedSceneCount).toBe(1)
    expect(second.scenes?.[0]?.parts).toHaveLength(2)
  })

  it("частичный успех: вторая часть упала — сцена отдаёт первую, а не пропадает", async () => {
    let call = 0
    h.runLipSync.mockImplementation(async (req: { outputPath: string }) => {
      call += 1
      if (call === 2) throw new Error("провайдер отбил вторую часть")
      await writeFile(req.outputPath, "video")
      return { costUsd: 0.07, provider: "replicate", outputPath: req.outputPath }
    })

    const result = await runLipSyncStep({
      videoId: 33,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([9]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([longScene(9)], 95),
    })

    // Сцена считается синхронизированной: одна часть есть — гейт «ни одной
    // сцены» в video-pipeline.ts не должен уронить ролик из-за хвоста.
    expect(result.syncedSceneCount).toBe(1)
    expect(result.clipPaths[0]).toBe(join(ASSETS_DIR, "scene_0_lipsync.mp4"))

    const parts = result.scenes?.[0]?.parts
    expect(parts).toHaveLength(2)
    expect(parts![0]!.outputPath).toBeTruthy()
    expect(parts![1]!.outputPath).toBeNull()
    expect(parts![1]!.skipped).toBe("lip_sync_failed")
  })

  it("после частичного успеха повтор доделывает упавшую часть и НЕ платит за готовую", async () => {
    let call = 0
    h.runLipSync.mockImplementation(async (req: { outputPath: string }) => {
      call += 1
      if (call === 2) throw new Error("провайдер отбил вторую часть")
      await writeFile(req.outputPath, "video")
      return { costUsd: 0.07, provider: "replicate", outputPath: req.outputPath }
    })

    const first = await runLipSyncStep({
      videoId: 35,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([9]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([longScene(9)], 95),
    })
    expect(first.scenes?.[0]?.parts?.[1]?.outputPath).toBeNull()

    // Прогон 2: провайдер снова работает. Упавшая часть обязана получить вторую
    // попытку, готовая — остаться неоплаченной.
    h.step = { id: 707, attemptCount: 1, actualCost: 0.07, outputSnapshot: first as unknown }
    h.runLipSync.mockReset()
    h.runLipSync.mockImplementation(async (req: { outputPath: string }) => {
      await writeFile(req.outputPath, "video")
      return { costUsd: 0.07, provider: "replicate", outputPath: req.outputPath }
    })

    const second = await runLipSyncStep({
      videoId: 35,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([9]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([longScene(9)], 95),
    })

    // Ровно ОДИН платный вызов — за упавшую часть, а не за обе.
    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(second.scenes?.[0]?.parts?.every(part => part.outputPath)).toBe(true)
  })

  it("обрыв между частями оставляет оплаченную часть в снапшоте", async () => {
    // Заливка второй части падает: шаг бросает, но за первую часть уже
    // заплачено — она обязана остаться в снапшоте, иначе следующий заход
    // оплатит её второй раз.
    let uploads = 0
    h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => {
      uploads += 1
      if (uploads === 2) throw new Error("хранилище недоступно")
      return { storageKey, storageProvider: "local", storageBucket: null }
    })

    await expect(runLipSyncStep({
      videoId: 36,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([9]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([longScene(9)], 95),
    })).rejects.toThrow(/хранилище недоступно/)

    const failed = h.snapshots.at(-1) as { scenes?: Array<{ parts?: Array<{ outputPath: string | null }> }> }
    expect(failed.scenes?.[0]?.parts?.[0]?.outputPath).toBe(join(ASSETS_DIR, "scene_0_lipsync.mp4"))
  })

  it("снапшот старого формата (одна запись на сцену, без parts) переиспользуется", async () => {
    // Прогон 1 на КОРОТКОЙ сцене — запись прежней формы, без списка частей.
    const first = await runLipSyncStep({
      videoId: 34,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([1]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([shortScene(1, 0, 8)], 8),
    })
    expect(first.scenes?.[0]?.parts).toBeUndefined()

    h.step = { id: 707, attemptCount: 1, actualCost: 0.07, outputSnapshot: first as unknown }
    h.runLipSync.mockClear()

    const second = await runLipSyncStep({
      videoId: 34,
      clipPaths: [""],
      videoPlan: presenterOnlyPlan([1]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([shortScene(1, 0, 8)], 8),
    })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(second.totalCostUsd).toBe(0)
    expect(second.syncedSceneCount).toBe(1)
  })
})

describe("planLipSyncParts: чистое планирование частей", () => {
  it("сцена короче потолка — ровно одна часть с границами сцены", async () => {
    const { planLipSyncParts } = await import("../../../server/utils/presenter/lip-sync-parts")
    const plan = planLipSyncParts({
      scene: shortScene(1, 0, 8),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
      trackDurationSec: 8,
    })
    expect(plan.parts).toHaveLength(1)
    expect(plan.parts[0]!.startSec).toBeCloseTo(0, 6)
    expect(plan.parts[0]!.endSec).toBeCloseTo(8, 6)
    expect(plan.splitUnavailable).toBe(false)
  })

  it("сцена без пословных границ дробить нечем — одна часть и явный признак", async () => {
    const { planLipSyncParts } = await import("../../../server/utils/presenter/lip-sync-parts")
    const plan = planLipSyncParts({
      scene: { order: 9, startSec: SCENE_START, endSec: SCENE_END, words: [] },
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
      trackDurationSec: 95,
    })
    expect(plan.parts).toHaveLength(1)
    expect(plan.splitUnavailable).toBe(true)
  })

  it("часть не вылезает за конец трека", async () => {
    const { planLipSyncParts } = await import("../../../server/utils/presenter/lip-sync-parts")
    const plan = planLipSyncParts({
      scene: longScene(9),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
      trackDurationSec: 88,
    })
    const last = plan.parts[plan.parts.length - 1]!
    expect(last.endSec).toBeLessThanOrEqual(88 + 1e-9)
  })
})
