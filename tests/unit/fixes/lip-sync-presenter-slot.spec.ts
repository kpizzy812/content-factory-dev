/**
 * Регрессия: в СМЕШАННОМ ролике (часть сцен снимает ведущая, часть — text-to-video)
 * сцена ведущей приходит в lip-sync с ПУСТОЙ ячейкой в clipPaths — своего
 * сгенерированного клипа у неё нет и быть не должно.
 *
 * Раньше список клипов был плотным, и сцена ведущей адресовалась в чужую ячейку:
 * исходником ей доставался клип соседней сцены, а результат затирал этого соседа.
 * После перехода на список по сценам ячейка честно пуста — и шаг обязан увидеть в
 * этом маршрут ведущей (фрагмент из библиотеки), а не «клипа нет, пропускаю».
 *
 * DB-free: prisma, TTS, lip-sync, storage и ffprobe замоканы.
 */

import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runLipSyncStep } from "../../../server/utils/lip-sync-runner"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const h = vi.hoisted(() => ({
  assetsDir: "",
  step: { id: 202, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  clipAssets: new Map<number, { id: string; filePath: string }>(),
  createdAssets: [] as Array<{ order: number; filePath: string }>,
  durationByPath: new Map<string, number>(),
  synthesizeSpeech: vi.fn(),
  runLipSync: vi.fn(),
  probeMediaDuration: vi.fn(),
  adjustAudioTempo: vi.fn(),
  reservePresenterSourceClip: vi.fn(),
  /** Длительность речи, которую «намерил» ffprobe у синтезированного файла. */
  speechDurationSec: 5,
}))

vi.mock("../../../server/utils/prisma", () => ({
  prisma: {
    videoAsset: {
      findFirst: async (args: { where: { order: number } }) => h.clipAssets.get(args.where.order) ?? null,
      update: async () => ({}),
      create: async (args: { data: { order: number; filePath: string } }) => {
        h.createdAssets.push({ order: args.data.order, filePath: args.data.filePath })
        return { id: "new" }
      },
    },
    // Порядок нарезки тождественный: сцена order N — позиция N-1.
    videoGenerationStep: {
      findFirst: async () => ({
        outputSnapshot: { scenePrompts: { scenes: [1, 2, 3].map(order => ({ order, prompt: "p" })) } },
      }),
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
  uploadLocalAsset: async (_p: string, storageKey: string) => ({ storageKey, storageProvider: "local" }),
}))
vi.mock("../../../server/utils/video-helpers", () => ({ downloadFile: async () => undefined }))

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-presenter-slot")
h.assetsDir = ASSETS_DIR

const VIDEO_CONFIG = {
  lipSyncEnabled: true,
  lipSyncModelId: null,
  lipSyncCharacterId: "cmliana000000reforma0001",
  voiceoverModelId: null,
  voiceoverVoiceId: null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as const,
}

/** Смешанный ролик: реплика в кадре только у средней сцены. */
function mixedPlan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [
      { order: 1, spokenLine: null, voiceoverLine: "закадр 1", durationSec: 5 },
      { order: 2, spokenLine: "Я скажу это в кадре", voiceoverLine: null, durationSec: 5 },
      { order: 3, spokenLine: null, voiceoverLine: "закадр 3", durationSec: 5 },
    ],
  } as unknown as StoryDrivenVideoPlan
}

beforeEach(async () => {
  await rm(ASSETS_DIR, { recursive: true, force: true })
  await mkdir(ASSETS_DIR, { recursive: true })

  h.step = { id: 202, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.clipAssets.clear()
  h.createdAssets.length = 0
  h.durationByPath.clear()

  h.synthesizeSpeech.mockReset()
  h.synthesizeSpeech.mockImplementation(async (args: { outputPath: string }) => {
    await writeFile(args.outputPath, "tts")
    return { costUsd: 0.002 }
  })

  h.runLipSync.mockReset()
  h.runLipSync.mockImplementation(async (req: { outputPath: string }) => {
    // Файл на диске обязателен: по нему следующий заход решает, есть ли что переиспользовать.
    await writeFile(req.outputPath, "video")
    return { costUsd: 0.07, provider: "replicate", outputPath: req.outputPath }
  })

  h.speechDurationSec = 5
  h.probeMediaDuration.mockReset()
  // Речь и фрагмент ведущей одной длины — иначе фрагмент отбраковывается как
  // разошедшийся с длиной реплики.
  h.probeMediaDuration.mockImplementation(async (path: string) => {
    const known = h.durationByPath.get(path)
    if (known !== undefined) return known
    // Синтезированная реплика и её ускоренная версия узнаются по имени файла.
    if (path.includes("_fit.mp3")) return h.speechDurationSec / 1.2
    if (path.includes("_spoken_")) return h.speechDurationSec
    return 5
  })

  h.adjustAudioTempo.mockReset()
  h.adjustAudioTempo.mockImplementation(async (input: string, output: string, speed: number) => {
    await writeFile(output, "tts-fit")
    return { outputPath: output, durationSec: h.speechDurationSec / speed }
  })

  h.reservePresenterSourceClip.mockReset()
  h.reservePresenterSourceClip.mockResolvedValue({
    id: "frag-7",
    name: "frag.mp4",
    fileUrl: "https://storage/frag.mp4",
    storageKey: "presenter/frag.mp4",
    durationSec: 5,
  })
})

describe("runLipSyncStep: пустая ячейка сцены — это маршрут ведущей", () => {
  it("сцена ведущей берёт фрагмент из библиотеки, а не пропускается как «клипа нет»", async () => {
    const clipPaths = [join(ASSETS_DIR, "scene_1_clip.mp4"), "", join(ASSETS_DIR, "scene_3_clip.mp4")]

    const result = await runLipSyncStep({
      videoId: 23,
      clipPaths,
      videoPlan: mixedPlan(),
      clipSceneOrders: [1, 2, 3],
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    const call = h.runLipSync.mock.calls[0]![0] as { sourceVideoPath: string }
    expect(call.sourceVideoPath).toBe(join(ASSETS_DIR, "presenter_1_frag-7.mp4"))

    // Результат встал в СВОЮ ячейку, соседи не тронуты.
    expect(result.clipPaths).toEqual([
      clipPaths[0],
      join(ASSETS_DIR, "scene_1_lipsync.mp4"),
      clipPaths[2],
    ])
    expect(result.syncedSceneCount).toBe(1)
  })

  it("клип сцены ведущей заводится в БД под индексом своей сцены", async () => {
    await runLipSyncStep({
      videoId: 23,
      clipPaths: [join(ASSETS_DIR, "scene_1_clip.mp4"), "", join(ASSETS_DIR, "scene_3_clip.mp4")],
      videoPlan: mixedPlan(),
      clipSceneOrders: [1, 2, 3],
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.createdAssets).toEqual([{ order: 1, filePath: join(ASSETS_DIR, "scene_1_lipsync.mp4") }])
  })

  it("персонажа нет — пустая ячейка остаётся пустой и сцена честно пропускается", async () => {
    const result = await runLipSyncStep({
      videoId: 23,
      clipPaths: [join(ASSETS_DIR, "scene_1_clip.mp4"), "", join(ASSETS_DIR, "scene_3_clip.mp4")],
      videoPlan: mixedPlan(),
      clipSceneOrders: [1, 2, 3],
      videoConfig: { ...VIDEO_CONFIG, lipSyncCharacterId: null },
    })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(result.clipPaths[1]).toBe("")
  })

  it("повторный заход переиспользует готовую сцену ведущей, а не оплачивает её заново", async () => {
    const clipPaths = [join(ASSETS_DIR, "scene_1_clip.mp4"), "", join(ASSETS_DIR, "scene_3_clip.mp4")]
    const first = await runLipSyncStep({
      videoId: 23,
      clipPaths,
      videoPlan: mixedPlan(),
      clipSceneOrders: [1, 2, 3],
      videoConfig: VIDEO_CONFIG,
    })

    // Второй заход видит снапшот первого. Фрагмент ведущей к этому моменту уже
    // удалён (он резервируется заново на каждом прогоне) — отпечаток сцены не
    // имеет права на него опираться.
    h.step = { ...h.step, attemptCount: 1, outputSnapshot: first as unknown }
    h.clipAssets.set(1, { id: "created", filePath: join(ASSETS_DIR, "scene_1_lipsync.mp4") })
    h.runLipSync.mockClear()

    const second = await runLipSyncStep({
      videoId: 23,
      clipPaths,
      videoPlan: mixedPlan(),
      clipSceneOrders: [1, 2, 3],
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(second.clipPaths).toEqual(first.clipPaths)
    expect(second.totalCostUsd).toBe(0)
  })

  it("реплика длиннее потолка модели ускоряется, а не роняет шаг", async () => {
    // Ролик 24, сцена 4: Fish прочитал реплику за 11.55 с при потолке модели 10 с.
    h.speechDurationSec = 11.55
    h.reservePresenterSourceClip.mockResolvedValue({
      id: "frag-long",
      name: "frag.mp4",
      fileUrl: "https://storage/frag.mp4",
      storageKey: "presenter/frag.mp4",
      durationSec: 9.6,
    })
    h.durationByPath.set(join(ASSETS_DIR, "presenter_1_frag-long.mp4"), 9.6)

    const result = await runLipSyncStep({
      videoId: 23,
      clipPaths: [join(ASSETS_DIR, "scene_1_clip.mp4"), "", join(ASSETS_DIR, "scene_3_clip.mp4")],
      videoPlan: mixedPlan(),
      clipSceneOrders: [1, 2, 3],
      videoConfig: VIDEO_CONFIG,
    })

    // Фрагмент ищем под УСКОРЕННУЮ речь: под 11.55 с в библиотеке нет ничего,
    // и раньше шаг падал целиком, унося весь ролик.
    const reserved = h.reservePresenterSourceClip.mock.calls[0]![0] as { durationSec: number }
    expect(reserved.durationSec).toBeLessThanOrEqual(10)
    expect(reserved.durationSec).toBeGreaterThan(9)

    // В модель уходит ускоренная реплика — целая, а не обрезанная по длине исходника.
    expect(h.adjustAudioTempo).toHaveBeenCalled()
    const lipSyncCall = h.runLipSync.mock.calls[0]![0] as { audioPath: string; durationSec: number }
    expect(lipSyncCall.audioPath).toContain("_fit.mp3")
    expect(result.clipPaths[1]).toBe(join(ASSETS_DIR, "scene_1_lipsync.mp4"))
  })

  it("ролик целиком из сцен ведущей узнаётся по пустым ячейкам, а не по пустому списку", async () => {
    const plan = {
      mode: "story_driven",
      scenes: [
        { order: 1, spokenLine: "Реплика один", durationSec: 5 },
        { order: 2, spokenLine: "Реплика два", durationSec: 5 },
      ],
    } as unknown as StoryDrivenVideoPlan

    // Шаг клипов ролика ведущей отдаёт ячейки под каждую сцену — все пустые.
    const result = await runLipSyncStep({
      videoId: 24,
      clipPaths: ["", ""],
      videoPlan: plan,
      clipSceneOrders: null,
      videoConfig: VIDEO_CONFIG,
    })

    expect(result.clipPaths).toEqual([
      join(ASSETS_DIR, "scene_0_lipsync.mp4"),
      join(ASSETS_DIR, "scene_1_lipsync.mp4"),
    ])
  })
})
