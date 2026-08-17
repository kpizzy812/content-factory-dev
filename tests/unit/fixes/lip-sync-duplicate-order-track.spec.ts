/**
 * Дубль `order` не должен отдавать сцене чужой кусок трека (маршрут «монтаж
 * от звука», lip-sync-runner.ts:292 и далее).
 *
 * До фикса `alignedSceneByOrder` строилась «побеждает последний»: у ролика,
 * снятого целиком ведущей (order сцен планировщика умеет повторяться), обе
 * сцены с одинаковым order получали ОДИН И ТОТ ЖЕ кусок общего трека — одна
 * из двух presenter-сцен синхронизировалась под чужой отрезок, губы
 * произносили слова соседней сцены, и это было оплачено.
 *
 * Фикс адресует кусок трека по ПОЗИЦИИ сцены в sceneUnits (== videoPlan.scenes,
 * ссылка без копирования — см. lip-sync-runner.ts объявление sceneUnits), но
 * только когда это позиционное тождество с audioFirst.scenes ПОДТВЕРЖДЕНО той
 * же чистой функцией, что video-pipeline-steps.ts применяет к якорям подгона
 * длины (alignedScenesMatchPlanPositions, presenter/scene-clip-mapping.ts). На
 * неподтверждённом тождестве поведение обязано остаться прежним: карта по
 * order, тот же WARN.
 *
 * Сценарий взят именно presenterOnlyVideo (`clipSceneOrders: []`, все ячейки
 * clipPaths пустые, у каждой сцены есть свой персонаж-фрагмент): это
 * ЕДИНСТВЕННЫЙ путь в коде, где выбор КЛИПА для сцены уже корректно
 * позиционен (sceneUnits.indexOf(scene), см. presenterOnlyVideo-ветку
 * sceneIndexOf) и НЕ путается дублем order — а значит тест бьёт ровно по
 * куску трека, не смешивая его с независимой (и намеренно не позиционной)
 * картой выбора клипа buildSceneClipIndexMap.
 *
 * DB-free: prisma, TTS, lip-sync, storage, presenter-source-selector и
 * fluent-ffmpeg (вырезка куска трека) замоканы. Ни одного платного вызова.
 */

import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runLipSyncStep } from "../../../server/utils/lip-sync-runner"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

type ProbeCallback = (err: Error | null, metadata?: { format?: { duration?: number } }) => void

const h = vi.hoisted(() => ({
  assetsDir: "",
  step: { id: 909, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  durationByPath: new Map<string, number>(),
  ffmpegRuns: [] as Array<{ input: string; output: string; outputOptions: string[] }>,
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
      create: async () => ({ id: "new" }),
      update: async () => ({}),
    },
  },
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async () => undefined,
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

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-dup-order-track")
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

/** Ролик целиком ведущей: пустые ячейки clipPaths, у каждой сцены реплика. */
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

type AlignedSceneInput = { order: number; startSec: number; endSec: number }

function audioFirstInput(scenes: AlignedSceneInput[], trackDurationSec: number) {
  return {
    trackPath: TRACK_PATH,
    trackDurationSec,
    trackFingerprint: "track-v1",
    fps: 30,
    scenes: scenes.map(s => ({ ...s, words: [] })),
  }
}

/** Длительность куска (`-t`), которую фейковый ffmpeg реально получил на входе. */
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

  h.step = { id: 909, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.durationByPath.clear()
  h.ffmpegRuns.length = 0

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
    // Фрагмент ведущего (presenter_*) и всё прочее — безопасная длина внутри
    // диапазона любой lip-sync модели (kling: 2-10с).
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

describe("runLipSyncStep: дубль order сцены не отдаёт чужой кусок трека", () => {
  it("подтверждённое позиционное тождество: обе сцены с дублем order получают СВОИ куски", async () => {
    // 3 сцены, order [1, 1, 2] — дубль на позициях 0 и 1. Выравнивание идёт
    // в ТОМ ЖЕ порядке и с ТЕМИ ЖЕ order, что и план (позиционное тождество
    // держится), но границы у каждой сцены РАЗНЫЕ и разной длины: 3с, 6с, 4с.
    const result = await runLipSyncStep({
      videoId: 91,
      clipPaths: ["", "", ""],
      videoPlan: presenterOnlyPlan([1, 1, 2]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([
        { order: 1, startSec: 0, endSec: 3 },
        { order: 1, startSec: 3, endSec: 9 },
        { order: 2, startSec: 9, endSec: 13 },
      ], 13),
    })

    // Каждая из трёх сцен реально дошла до вырезки СВОЕГО куска — не общего.
    expect(h.ffmpegRuns).toHaveLength(3)
    const durations = cutDurations()
    // Позиция 0 (order=1) — 3с. Позиция 1 (order=1, дубль) — 6с, а НЕ те же 3с
    // и не те же границы, что у позиции 0: до фикса «побеждает последний» обе
    // сцены с order=1 получили бы кусок позиции 1 (6с) — здесь ровно та
    // развилка, которую проверяет тест.
    expect(durations[0]).toBeCloseTo(3, 2)
    expect(durations[1]).toBeCloseTo(6, 2)
    expect(durations[2]).toBeCloseTo(4, 2)

    // Дошло до платного вызова трижды — по разу на сцену, ни одна не пропущена
    // как "нет выравнивания".
    expect(h.runLipSync).toHaveBeenCalledTimes(3)
    expect(result.syncedSceneCount).toBe(3)
    expect(result.clipPaths).toEqual([
      join(ASSETS_DIR, "scene_0_lipsync.mp4"),
      join(ASSETS_DIR, "scene_1_lipsync.mp4"),
      join(ASSETS_DIR, "scene_2_lipsync.mp4"),
    ])

    // Лог объясняет дубль честно: он ложный, а не "получат один кусок трека".
    expect(h.logs.some(line => line.includes("дубль ложный"))).toBe(true)
    expect(h.logs.some(line => line.includes("получат один кусок трека"))).toBe(false)
  })

  it("неподтверждённое тождество (сцена выпала из выравнивания): поведение прежнее — карта по order, WARN на месте", async () => {
    // Тот же план (order [1, 1, 2]), но выравнивание короче плана (2 сцены
    // вместо 3, будто третья сцена схлопнулась в voiceover/track-builder.ts) —
    // длины расходятся, alignedScenesMatchPlanPositions не подтверждена.
    const result = await runLipSyncStep({
      videoId: 92,
      clipPaths: ["", "", ""],
      videoPlan: presenterOnlyPlan([1, 1, 2]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([
        { order: 1, startSec: 0, endSec: 3 },
        { order: 1, startSec: 3, endSec: 9 },
      ], 13),
    })

    // Прежний WARN, дословно.
    expect(h.logs.some(line => line ===
      "WARN в выравнивании повторяются order сцен: 1 — "
      + "беру последние границы, но сцены с одинаковым order получат один кусок трека")).toBe(true)

    // Прежнее поведение "побеждает последний": обе сцены order=1 получают
    // ОДИН И ТОТ ЖЕ (последний зарегистрированный) кусок — 6с у обеих.
    expect(h.ffmpegRuns).toHaveLength(2)
    const durations = cutDurations()
    expect(durations[0]).toBeCloseTo(6, 2)
    expect(durations[1]).toBeCloseTo(6, 2)

    // Третья сцена (order=2) — выравнивания для неё нет вовсе, честный отказ,
    // а не порча под чужой кусок.
    expect(result.clipPaths[2]).toBe("")
    expect(h.logs.some(line => line.includes("в выравнивании нет границ этой сцены"))).toBe(true)

    // Клипы у первых двух сцен свои (позиционный выбор КЛИПА не задет фиксом
    // куска трека — это отдельная карта, buildSceneClipIndexMap/sceneUnits.indexOf).
    expect(result.clipPaths[0]).toBe(join(ASSETS_DIR, "scene_0_lipsync.mp4"))
    expect(result.clipPaths[1]).toBe(join(ASSETS_DIR, "scene_1_lipsync.mp4"))
  })

  it("обычный ролик без дублей order: поведение не изменилось", async () => {
    const result = await runLipSyncStep({
      videoId: 93,
      clipPaths: ["", "", ""],
      videoPlan: presenterOnlyPlan([1, 2, 3]),
      clipSceneOrders: [],
      videoConfig: VIDEO_CONFIG,
      audioFirst: audioFirstInput([
        { order: 1, startSec: 0, endSec: 3 },
        { order: 2, startSec: 3, endSec: 7 },
        { order: 3, startSec: 7, endSec: 11 },
      ], 11),
    })

    expect(h.ffmpegRuns).toHaveLength(3)
    const durations = cutDurations()
    expect(durations[0]).toBeCloseTo(3, 2)
    expect(durations[1]).toBeCloseTo(4, 2)
    expect(durations[2]).toBeCloseTo(4, 2)

    expect(result.syncedSceneCount).toBe(3)
    // Без дублей order лог о дубле не появляется вовсе — ни новым, ни старым текстом.
    expect(h.logs.some(line => line.includes("order сцен"))).toBe(false)
  })
})
