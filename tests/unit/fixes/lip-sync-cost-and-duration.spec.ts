/**
 * Регрессия на остаточные дефекты шага lip_sync_generation (второй проход ревью).
 *
 *   C1 — actualCost шага ПЕРЕЗАПИСЫВАЛСЯ стоимостью текущего прогона. Прогон, где
 *        все сцены переиспользованы (totalCostUsd=0), обнулял уже записанные
 *        деньги: $0.42 за пять сцен исчезали из totalCostActual. Тот же баг был в
 *        persistProgress, который пишет actualCost после каждой оплаченной сцены.
 *   C2 — проверка «источник в диапазоне модели» опиралась на probeClipDurations,
 *        а он реализован как `resolve(metadata?.format?.duration || 5)` и игнорирует
 *        err. Битый/отсутствующий файл всегда мерился как «5 с, всё ок», и проверка
 *        превращалась в константу. Нужен строгий probeMediaDuration → null.
 *   C3 — ключом переиспользования готового lip-sync был ТОЛЬКО хэш текста реплики.
 *        Смена персонажа, голоса/модели TTS или перегенерация исходного клипа
 *        старый файл не инвалидировали — сцена оставалась с lip-sync поверх
 *        устаревшего источника.
 *   C4 — при отсутствующем снапшоте prompt_generation карта «сцена → клип»
 *        строилась по позициям в videoPlan.scenes. Порядок нарезки задаёт Claude
 *        (prompts.scenePrompts.scenes), так что позиционная догадка могла отдать
 *        реплику на ЧУЖОЙ клип, причём за деньги.
 *
 * DB-free: prisma/tts/lip-sync/storage замоканы, ffprobe подменён на уровне
 * fluent-ffmpeg (render.ts настоящий), файлы — только в tmpdir.
 */

import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildLipSyncReuseKey, hashSpokenLine } from "../../../server/utils/presenter/scene-clip-mapping"
import { probeClipDurations, probeMediaDuration } from "../../../server/utils/render"
import { runLipSyncStep } from "../../../server/utils/lip-sync-runner"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

type ProbeCallback = (err: Error | null, metadata?: { format?: { duration?: number } }) => void

const h = vi.hoisted(() => ({
  assetsDir: "",
  stepCompleted: false,
  step: { id: 303, attemptCount: 0, actualCost: null as number | null, outputSnapshot: null as unknown },
  promptSnapshot: null as unknown,
  clipAssets: new Map<number, { id: string; filePath: string }>(),
  /**
   * Что «видит» ffprobe. Пути нет в карте — ffprobe падает (битый файл, нет файла,
   * нет самого ffprobe). Значение <= 0 — метаданные без длительности.
   */
  durationByPath: new Map<string, number>(),
  ffprobe: vi.fn(),
  assetFindFirst: vi.fn(),
  appendStepLog: vi.fn(),
  updateStep: vi.fn(),
  synthesizeSpeech: vi.fn(),
  runLipSync: vi.fn(),
  uploadLocalAsset: vi.fn(),
  logStepCost: vi.fn(),
  reservePresenterSourceClip: vi.fn(),
}))

// ffprobe подменяем на уровне библиотеки, а render.ts остаётся настоящим — иначе
// тест проверял бы мок вместо строгого замера, ради которого всё и затевалось.
vi.mock("fluent-ffmpeg", () => {
  const ffmpeg = Object.assign(
    () => { throw new Error("ffmpeg-пайплайн в юнит-тестах не запускается") },
    { ffprobe: (path: string, cb: ProbeCallback) => h.ffprobe(path, cb) },
  )
  return { default: ffmpeg }
})

vi.mock("../../../server/utils/prisma", () => ({
  prisma: {
    videoAsset: { findFirst: h.assetFindFirst },
    videoGenerationStep: { findFirst: async () => ({ outputSnapshot: h.promptSnapshot }) },
  },
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: h.updateStep,
  appendStepLog: h.appendStepLog,
  isStepCompleted: () => h.stepCompleted,
  updateVideoStatus: async () => undefined,
}))

vi.mock("../../../server/utils/tts", () => ({ synthesizeSpeech: h.synthesizeSpeech }))
vi.mock("../../../server/utils/media-provider/lip-sync", () => ({ runLipSync: h.runLipSync }))
vi.mock("../../../server/utils/presenter-source-selector", () => ({
  reservePresenterSourceClip: h.reservePresenterSourceClip,
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: h.logStepCost }))
vi.mock("../../../server/utils/storage-paths", () => ({
  getAssetsDirFor: () => h.assetsDir,
  getVideosBase: () => h.assetsDir,
}))
vi.mock("../../../server/utils/storage", () => ({
  getStorageDriver: () => ({ downloadToFile: async () => undefined }),
}))
vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: (...args: unknown[]) => h.uploadLocalAsset(...args),
}))
vi.mock("../../../server/utils/video-helpers", () => ({ downloadFile: async () => undefined }))

const ASSETS_DIR = join(tmpdir(), "cf-lip-sync-cost-duration")
h.assetsDir = ASSETS_DIR

const clipPath = (index: number) => join(ASSETS_DIR, `scene_${index}_clip.mp4`)
const lipSyncPath = (index: number) => join(ASSETS_DIR, `scene_${index}_lipsync.mp4`)

const VIDEO_CONFIG = {
  lipSyncEnabled: true,
  lipSyncModelId: null as string | null,
  lipSyncCharacterId: null as string | null,
  voiceoverModelId: null as string | null,
  voiceoverVoiceId: null as string | null,
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as "slow" | "moderate" | "fast",
}
type VideoConfig = typeof VIDEO_CONFIG

/** Тождественный порядок нарезки: order N лежит в клипе N-1. */
const IDENTITY_PROMPT_SNAPSHOT = {
  scenePrompts: { scenes: [1, 2, 3, 4, 5].map(order => ({ order, prompt: "p" })) },
}

function makePlan(scenes: Array<{ order: number; spokenLine: string | null; durationSec: number }>): StoryDrivenVideoPlan {
  return { mode: "story_driven", scenes, totalDurationSec: 0 } as unknown as StoryDrivenVideoPlan
}

/** Отпечаток сцены — ровно тот, что считает runner (buildLipSyncReuseKey). */
async function reuseKeyFor(
  spokenLine: string,
  sourcePath: string,
  config: VideoConfig = VIDEO_CONFIG,
): Promise<string> {
  let sourceSignature: string | null = null
  try {
    const stats = await stat(sourcePath)
    sourceSignature = `${stats.size}:${Math.round(stats.mtimeMs)}`
  } catch { /* файла нет — runner тоже получит null */ }
  return buildLipSyncReuseKey({
    spokenLine,
    sourcePath,
    sourceSignature,
    lipSyncCharacterId: config.lipSyncCharacterId,
    lipSyncModelId: config.lipSyncModelId,
    voiceoverModelId: config.voiceoverModelId,
    voiceoverVoiceId: config.voiceoverVoiceId,
    voiceoverLanguage: config.voiceoverLanguage,
    voiceoverPacing: config.voiceoverPacing,
  })
}

/** Кладёт клипы на диск и регистрирует их в БД-моке. durationSec=null → битый файл. */
async function seedClips(count: number, durationSec: number | null = 5): Promise<string[]> {
  const paths: string[] = []
  for (let index = 0; index < count; index++) {
    await writeFile(clipPath(index), `clip-${index}`)
    h.clipAssets.set(index, { id: `asset-${index}`, filePath: clipPath(index) })
    if (durationSec !== null) h.durationByPath.set(clipPath(index), durationSec)
    paths.push(clipPath(index))
  }
  return paths
}

async function sceneRecord(index: number, spokenLine: string, config: VideoConfig = VIDEO_CONFIG) {
  return {
    sceneOrder: index + 1,
    sceneIndex: index,
    sourcePath: clipPath(index),
    outputPath: lipSyncPath(index),
    audioPath: null,
    spokenLineHash: hashSpokenLine(spokenLine),
    reuseKey: await reuseKeyFor(spokenLine, clipPath(index), config),
    durationSec: 5,
  }
}

/** Последний actualCost, который шаг записал в БД. */
function lastActualCost(): number | undefined {
  for (let i = h.updateStep.mock.calls.length - 1; i >= 0; i--) {
    const payload = h.updateStep.mock.calls[i]![1] as { actualCost?: number }
    if (typeof payload?.actualCost === "number") return payload.actualCost
  }
  return undefined
}

function lipSyncSources(): string[] {
  return h.runLipSync.mock.calls.map(call => (call[0] as { sourceVideoPath: string }).sourceVideoPath)
}

function stepLog(): string {
  return h.appendStepLog.mock.calls.map(call => String(call[1])).join("\n")
}

beforeEach(async () => {
  await rm(ASSETS_DIR, { recursive: true, force: true })
  await mkdir(ASSETS_DIR, { recursive: true })

  h.stepCompleted = false
  h.step = { id: 303, attemptCount: 0, actualCost: null, outputSnapshot: null }
  h.promptSnapshot = IDENTITY_PROMPT_SNAPSHOT
  h.clipAssets.clear()
  h.durationByPath.clear()

  h.ffprobe.mockReset()
  h.ffprobe.mockImplementation((path: string, cb: ProbeCallback) => {
    const duration = h.durationByPath.get(path)
    if (duration === undefined) {
      // Ровно тот случай, ради которого нужен строгий замер: файла нет / он битый /
      // ffprobe не установлен.
      cb(new Error("ffprobe: No such file or directory"))
      return
    }
    cb(null, duration > 0 ? { format: { duration } } : { format: {} })
  })

  h.assetFindFirst.mockReset()
  h.assetFindFirst.mockImplementation(async (args: { where: { order: number } }) =>
    h.clipAssets.get(args.where.order) ?? null)
  h.appendStepLog.mockReset()
  h.appendStepLog.mockResolvedValue(undefined)
  h.updateStep.mockReset()
  h.updateStep.mockResolvedValue(undefined)
  h.logStepCost.mockReset()
  h.logStepCost.mockResolvedValue(undefined)

  h.synthesizeSpeech.mockReset()
  h.synthesizeSpeech.mockImplementation(async (args: { outputPath: string }) => {
    await writeFile(args.outputPath, "tts")
    return { costUsd: 0.002 }
  })

  h.runLipSync.mockReset()
  h.runLipSync.mockImplementation(async (req: { outputPath: string }) => {
    await writeFile(req.outputPath, "synced")
    return { costUsd: 0.07, provider: "replicate", outputPath: req.outputPath }
  })

  h.uploadLocalAsset.mockReset()
  h.uploadLocalAsset.mockImplementation(async (_path: string, storageKey: string) => ({
    storageKey,
    storageProvider: "local",
    storageBucket: null,
  }))

  h.reservePresenterSourceClip.mockReset()
  h.reservePresenterSourceClip.mockResolvedValue(null)
})

// ─── C2: строгий замер длительности ──────────────────────────────────────────
describe("render: строгий замер длительности источника", () => {
  it("probeMediaDuration отличает ошибку ffprobe от реальной длительности", async () => {
    h.durationByPath.set(clipPath(0), 7.25)

    // Файла нет / ffprobe упал — null, а не «5 секунд».
    await expect(probeMediaDuration(clipPath(1))).resolves.toBeNull()
    await expect(probeMediaDuration(clipPath(0))).resolves.toBeCloseTo(7.25, 5)
  })

  it("probeMediaDuration возвращает null, когда в метаданных нет длительности", async () => {
    h.durationByPath.set(clipPath(0), 0)

    await expect(probeMediaDuration(clipPath(0))).resolves.toBeNull()
  })

  it("probeClipDurations сохраняет массивную семантику с дефолтом 5", async () => {
    h.durationByPath.set(clipPath(1), 3.5)

    // Сборка обязана построить таймлайн даже по неизмеримому клипу — иначе ролик
    // не соберётся вообще. Дефолт остаётся ТОЛЬКО здесь.
    await expect(probeClipDurations([clipPath(0), clipPath(1)])).resolves.toEqual([5, 3.5])
  })
})

describe("runLipSyncStep: неизмеримый источник", () => {
  it("сцена с битым исходником пропускается, а не синхронизируется с выдуманной длиной", async () => {
    const clipPaths = await seedClips(2)
    // Второй клип не читается ffprobe: раньше он молча становился «5 с» и уезжал в
    // модель, а проверка диапазона его пропускала.
    h.durationByPath.delete(clipPath(1))

    const result = await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: makePlan([
        { order: 1, spokenLine: "Реплика один", durationSec: 5 },
        { order: 2, spokenLine: "Реплика два", durationSec: 5 },
      ]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(lipSyncSources()).toEqual([clipPath(0)])
    expect(result.clipPaths[1]).toBe(clipPath(1))
    expect(result.syncedSceneCount).toBe(1)
    // За TTS сцены, которую всё равно не отдадим модели, платить незачем.
    expect(h.synthesizeSpeech).toHaveBeenCalledTimes(1)
    expect(stepLog()).toContain("не удалось измерить длительность источника")
  })

  it("неизмеримый исходник ведущего откатывается на сгенерированный клип", async () => {
    const clipPaths = await seedClips(1, 6)
    h.reservePresenterSourceClip.mockResolvedValue({
      id: "src-1",
      name: "src-1.mp4",
      fileUrl: "https://example.invalid/src-1.mp4",
      storageKey: null,
      durationSec: 6,
    })
    // Скачанный исходник ведущего не читается — доверять его длине нечем.

    await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика один", durationSec: 6 }]),
      videoConfig: { ...VIDEO_CONFIG, lipSyncCharacterId: "char-1" },
    })

    expect(lipSyncSources()).toEqual([clipPath(0)])
    expect(stepLog()).toContain("длительность исходника ведущего не измеряется")
  })
})

// ─── C1: деньги ──────────────────────────────────────────────────────────────
describe("runLipSyncStep: стоимость шага", () => {
  it("прогон, где всё переиспользовано, не обнуляет уже записанную стоимость", async () => {
    const clipPaths = await seedClips(2)
    for (const index of [0, 1]) await writeFile(lipSyncPath(index), "synced")
    h.step = {
      id: 303,
      attemptCount: 1,
      // Прошлый прогон синхронизировал обе сцены и записал стоимость.
      actualCost: 0.42,
      outputSnapshot: {
        scenes: [await sceneRecord(0, "Реплика 1"), await sceneRecord(1, "Реплика 2")],
      },
    }

    const result = await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: makePlan([1, 2].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(result.totalCostUsd).toBe(0)
    // Раньше сюда уезжал totalCostUsd=0 и $0.42 исчезали из отчёта по ролику.
    expect(lastActualCost()).toBeCloseTo(0.42, 10)
  })

  it("частично оплаченный прогон прибавляется к прошлым, а не заменяет их", async () => {
    const clipPaths = await seedClips(2)
    h.step = { id: 303, attemptCount: 1, actualCost: 0.42, outputSnapshot: null }
    // Заливка падает сразу — прогон обрывается после первой оплаченной сцены.
    h.uploadLocalAsset.mockImplementation(async () => { throw new Error("storage недоступен") })

    await expect(runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: makePlan([1, 2].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })).rejects.toThrow("storage недоступен")

    // 0.42 прошлой попытки + 0.072 этой (lip $0.07 + tts $0.002).
    expect(lastActualCost()).toBeCloseTo(0.492, 5)
  })

  it("первая попытка пишет стоимость прогона как есть", async () => {
    const clipPaths = await seedClips(1)
    h.step = { id: 303, attemptCount: 0, actualCost: null, outputSnapshot: null }

    await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: makePlan([{ order: 1, spokenLine: "Реплика 1", durationSec: 5 }]),
      videoConfig: VIDEO_CONFIG,
    })

    expect(lastActualCost()).toBeCloseTo(0.072, 5)
  })
})

// ─── C3: ключ переиспользования ──────────────────────────────────────────────
describe("runLipSyncStep: отпечаток переиспользования", () => {
  const onePlan = () => makePlan([{ order: 1, spokenLine: "Реплика 1", durationSec: 5 }])

  async function seedReusableScene(config: VideoConfig = VIDEO_CONFIG): Promise<string[]> {
    const clipPaths = await seedClips(1)
    await writeFile(lipSyncPath(0), "synced-раньше")
    h.step = {
      id: 303,
      attemptCount: 1,
      actualCost: 0.072,
      outputSnapshot: { scenes: [await sceneRecord(0, "Реплика 1", config)] },
    }
    return clipPaths
  }

  it("неизменные условия — сцена переиспользуется без повторной оплаты", async () => {
    const clipPaths = await seedReusableScene()

    const result = await runLipSyncStep({ videoId: 11, clipPaths, videoPlan: onePlan(), videoConfig: VIDEO_CONFIG })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(result.clipPaths[0]).toBe(lipSyncPath(0))
  })

  it("смена персонажа инвалидирует готовый lip-sync", async () => {
    // В снапшоте — результат прогона без персонажа.
    const clipPaths = await seedReusableScene()

    await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: onePlan(),
      videoConfig: { ...VIDEO_CONFIG, lipSyncCharacterId: "char-1" },
    })

    // Раньше ключом был только хэш текста — в сборку уезжал ролик с прежним лицом.
    expect(h.runLipSync).toHaveBeenCalledTimes(1)
  })

  it("смена голоса/модели TTS инвалидирует готовый lip-sync", async () => {
    const clipPaths = await seedReusableScene({ ...VIDEO_CONFIG, voiceoverVoiceId: "voice-a" })

    await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: onePlan(),
      videoConfig: { ...VIDEO_CONFIG, voiceoverVoiceId: "voice-b" },
    })

    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    // И реплику надо синтезировать заново: имя mp3 завязано на параметры синтеза,
    // иначе новый голос переиспользовал бы старый файл.
    expect(h.synthesizeSpeech).toHaveBeenCalledTimes(1)
  })

  it("перегенерация исходного клипа инвалидирует готовый lip-sync", async () => {
    const clipPaths = await seedReusableScene()
    // Клип перегенерировали: путь тот же (scene_0_clip.mp4), содержимое другое.
    await writeFile(clipPath(0), "clip-0-перегенерирован-и-заметно-длиннее")

    await runLipSyncStep({ videoId: 11, clipPaths, videoPlan: onePlan(), videoConfig: VIDEO_CONFIG })

    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(lipSyncSources()).toEqual([clipPath(0)])
  })

  it("запись старого формата (без отпечатка) не ломает шаг и не переиспользуется", async () => {
    const clipPaths = await seedClips(1)
    await writeFile(lipSyncPath(0), "synced-раньше")
    const legacy = await sceneRecord(0, "Реплика 1")
    // Снапшот, записанный до появления reuseKey.
    delete (legacy as { reuseKey?: unknown }).reuseKey
    h.step = { id: 303, attemptCount: 1, actualCost: 0.072, outputSnapshot: { scenes: [legacy] } }

    const result = await runLipSyncStep({ videoId: 11, clipPaths, videoPlan: onePlan(), videoConfig: VIDEO_CONFIG })

    expect(result.status).toBe("completed")
    expect(h.runLipSync).toHaveBeenCalledTimes(1)
    expect(stepLog()).toContain("без отпечатка")
  })

  it("completed-шаг с чужим персонажем не отдаёт кэш", async () => {
    const clipPaths = await seedClips(1)
    await writeFile(lipSyncPath(0), "synced-раньше")
    h.stepCompleted = true
    h.step = {
      id: 303,
      attemptCount: 1,
      actualCost: 0.072,
      outputSnapshot: {
        status: "completed",
        clipPaths: [lipSyncPath(0)],
        scenes: [await sceneRecord(0, "Реплика 1")],
      },
    }

    await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: onePlan(),
      videoConfig: { ...VIDEO_CONFIG, lipSyncCharacterId: "char-1" },
    })

    // Ранний return проверял только наличие записей — и возвращал кэш поверх
    // устаревших файлов.
    expect(h.runLipSync).toHaveBeenCalledTimes(1)
  })
})

// ─── C4: неизвестный порядок нарезки ─────────────────────────────────────────
describe("runLipSyncStep: неизвестный порядок клипов", () => {
  it("без снапшота prompt_generation сцены пропускаются, а не гадаются по позициям", async () => {
    const clipPaths = await seedClips(3)
    h.promptSnapshot = null

    const result = await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: makePlan([1, 2, 3].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })

    // Позиционная догадка при переставленных scenePrompts кладёт реплику на чужой
    // клип — и это уже оплаченный брак.
    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(result.clipPaths).toEqual(clipPaths)
    expect(result.syncedSceneCount).toBe(0)
    expect(stepLog()).toContain("Порядок нарезки клипов неизвестен")
  })

  it("дырявый снапшот (сцена без order) тоже считается неизвестным порядком", async () => {
    const clipPaths = await seedClips(2)
    h.promptSnapshot = { scenePrompts: { scenes: [{ order: 1, prompt: "p" }, { prompt: "p" }] } }

    const result = await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: makePlan([1, 2].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })

    expect(h.runLipSync).not.toHaveBeenCalled()
    expect(result.syncedSceneCount).toBe(0)
  })

  it("сцена, которой нет в известном порядке нарезки, пропускается с логом", async () => {
    const clipPaths = await seedClips(2)
    // Клипы нарезаны только по сценам 1 и 2, а реплика есть и у сцены 3.
    h.promptSnapshot = { scenePrompts: { scenes: [{ order: 1, prompt: "p" }, { order: 2, prompt: "p" }] } }

    const result = await runLipSyncStep({
      videoId: 11,
      clipPaths,
      videoPlan: makePlan([1, 2, 3].map(order => ({ order, spokenLine: `Реплика ${order}`, durationSec: 5 }))),
      videoConfig: VIDEO_CONFIG,
    })

    expect(result.syncedSceneCount).toBe(2)
    expect(stepLog()).toContain("Сцена order=3: клип не сопоставлен")
  })
})
