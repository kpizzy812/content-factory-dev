/**
 * Раннер локальной замены фразы: правка одной реплики не должна стоить как
 * новый ролик.
 *
 * Здесь проверяется то, ради чего вся задача и затевалась, — ДЕНЬГИ:
 *
 *  - кусок трека несдвинувшейся сцены обязан сохранить свой ключ
 *    переиспользования (`segmentIdentity`) БАЙТ В БАЙТ. Ключ считается по
 *    отпечатку трека, и наивная замена отпечатка на sha склеенного файла
 *    обесценила бы куски ВСЕГО ролика: 20 сцен × ~$0.7 lip-sync вместо одной;
 *  - повторный заход (и заход после падения посреди работы) не платит второй
 *    раз ни за синтез, ни за транскрипцию фразы;
 *  - длительность склейки ИЗМЕРЕНА ffprobe, а не выведена сложением
 *    (решение №5 хендоффа: трек — эталон времени);
 *  - на пересборку помечены ровно сдвинувшиеся сцены и ни одной лишней.
 *
 * Ни БД, ни сети, ни ffmpeg: раннер работает через порты (`store`, `media`),
 * тест подставляет их фейками и считает вызовы. Фейковая ФС — две карты
 * (файл → содержимое, файл → ответ ffprobe): именно по ним видно, что
 * оборванный прогон не оставил обрезанный трек под валидным именем.
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  planReplaceSegmentRequest,
  replaceVoiceoverSegment,
  type ReplaceSegmentDeps,
} from "~~/server/utils/voiceover/segment-replace-runner"
import { segmentIdentity } from "~~/server/utils/voiceover/segment-cut"
import { applyScriptOverrides } from "~~/server/utils/voiceover/script-overrides"
import type { AlignedScene } from "~~/server/utils/transcription/align"

const VIDEO_ID = 44
const ASSETS_DIR = "/assets/44"
const TRACK = `${ASSETS_DIR}/voiceover_track.mp3`
const FINGERPRINT = "fp-track-v1"
const STORAGE_KEY = "zavodcamp/videos/44/voiceover_mix.mp3"

/** Длительности сцен подобраны так, чтобы все границы лежали на кадре 30 fps. */
function scene(order: number, startSec: number, endSec: number, text: string): AlignedScene {
  return {
    order,
    startSec,
    endSec,
    words: [{ text, startSec, endSec, matched: true }],
  }
}

/** Запись сцены в снапшоте lip-sync — тот же формат, что пишет lip-sync-runner. */
function lipSyncRecord(sceneOrder: number, sceneIndex: number): Record<string, unknown> {
  return {
    sceneOrder,
    sceneIndex,
    outputPath: `${ASSETS_DIR}/scene_${sceneIndex}_lipsync.mp4`,
    audioPath: `${ASSETS_DIR}/scene_${sceneIndex}_track_aaa${sceneIndex}.mp3`,
    reuseKey: `reuse-${sceneOrder}`,
    durationSec: 5,
    skipped: null,
  }
}

interface World {
  deps: ReplaceSegmentDeps
  files: Map<string, string>
  durations: Map<string, number>
  steps: Map<string, { id: number, status: string, snapshot: Record<string, unknown> | null }>
  /**
   * ОБЩИЙ сценарий варианта (`ScenarioVariant.storyPlan`) — его читают все
   * ролики этого варианта. Замена не имеет права его трогать.
   */
  sharedPlan: Record<string, unknown> | null
  /** Правки сценария, личные для ЭТОГО ролика (`Video.scriptOverrides`). */
  overrides: unknown
  calls: {
    synthesize: Array<Record<string, unknown>>
    transcribe: Array<Record<string, unknown>>
    splice: Array<Record<string, unknown>>
    upload: string[]
    resetShots: number[][]
    costs: Array<{ stepKey: string, costUsd: number }>
    logs: string[]
    removed: string[]
    assets: Array<Record<string, unknown>>
    /** Каждая фиксация: какие шаги и уехал ли с ними патч сценария. */
    commits: Array<{ stepIds: number[], withScript: boolean }>
  }
  /** Что ответит ffprobe на склеенном файле. */
  splicedDurationSec: number
  /** Заставить ffmpeg-склейку упасть (обрыв процесса посреди работы). */
  spliceFails: boolean
  /** Заставить транскрипцию фразы упасть. */
  transcribeFails: boolean
  /** Провайдер ответил и деньги списаны, но границ из ответа не вышло. */
  transcribeGivesNothing: boolean
}

function makeWorld(options: {
  silences?: Array<{ startSec: number, endSec: number }>
  splicedDurationSec?: number
  phraseDurationSec?: number
  alignedScenes?: AlignedScene[]
  voiceoverSnapshot?: Record<string, unknown> | null
  resetShotsThrows?: boolean
  /** Длительность трека, записанная в снапшоте, — она бывает ОЦЕНКОЙ, а не фактом. */
  snapshotDurationSec?: number
  /** `null` — у ролика нет сценария вовсе (legacy, вариант отвязан). */
  script?: Record<string, unknown> | null
} = {}): World {
  const files = new Map<string, string>([
    [TRACK, "track-v1"],
    [`${ASSETS_DIR}/scene_0_lipsync.mp4`, "lipsync-1"],
    [`${ASSETS_DIR}/scene_0_track_aaa0.mp3`, "cut-1"],
    [`${ASSETS_DIR}/scene_1_lipsync.mp4`, "lipsync-2"],
    [`${ASSETS_DIR}/scene_1_track_aaa1.mp3`, "cut-2"],
    [`${ASSETS_DIR}/scene_2_lipsync.mp4`, "lipsync-3"],
    [`${ASSETS_DIR}/scene_2_track_aaa2.mp3`, "cut-3"],
  ])
  const durations = new Map<string, number>([[TRACK, 20]])
  const phraseDurationSec = options.phraseDurationSec ?? 6

  const alignedScenes = options.alignedScenes ?? [
    scene(1, 0, 5, "первая"),
    scene(2, 6, 10, "вторая"),
    scene(3, 11, 20, "третья"),
  ]

  const voiceoverSnapshot = options.voiceoverSnapshot === undefined
    ? {
        route: "audio_first",
        trackPath: TRACK,
        durationSec: options.snapshotDurationSec ?? 20,
        trackFingerprint: FINGERPRINT,
        storageKey: STORAGE_KEY,
        scenes: [
          { order: 1, text: "первая" },
          { order: 2, text: "вторая" },
          { order: 3, text: "третья" },
        ],
        totalCostUsd: 0.07,
        modelId: "minimax/speech-02-turbo",
        voiceId: "voice-1",
      }
    : options.voiceoverSnapshot

  const steps = new Map<string, { id: number, status: string, snapshot: Record<string, unknown> | null }>([
    ["voiceover_generation", { id: 101, status: "completed", snapshot: voiceoverSnapshot }],
    ["transcription", {
      id: 102,
      status: "completed",
      snapshot: { trackFingerprint: FINGERPRINT, scenes: alignedScenes, matchedRatio: 1, warning: null },
    }],
    ["lip_sync_generation", {
      id: 103,
      status: "completed",
      snapshot: {
        clipPaths: ["c0.mp4", "c1.mp4", "c2.mp4"],
        scenes: [
          lipSyncRecord(1, 0),
          lipSyncRecord(2, 1),
          {
            ...lipSyncRecord(3, 2),
            parts: [
              { index: 0, outputPath: `${ASSETS_DIR}/scene_2_lipsync.mp4`, audioPath: `${ASSETS_DIR}/scene_2_track_aaa2.mp3`, reuseKey: "reuse-3", durationSec: 4 },
              { index: 1, outputPath: `${ASSETS_DIR}/scene_2_part1_lipsync.mp4`, audioPath: `${ASSETS_DIR}/scene_2_part1_track.mp3`, reuseKey: "reuse-3b", durationSec: 5 },
            ],
          },
        ],
      },
    }],
  ])
  files.set(`${ASSETS_DIR}/scene_2_part1_lipsync.mp4`, "lipsync-3b")
  files.set(`${ASSETS_DIR}/scene_2_part1_track.mp3`, "cut-3b")

  const calls: World["calls"] = {
    synthesize: [],
    transcribe: [],
    splice: [],
    upload: [],
    resetShots: [],
    costs: [],
    logs: [],
    removed: [],
    assets: [],
    commits: [],
  }

  /**
   * Сценарий ролика: сцена 2 говорится ведущим в кадре (`spokenLine`), сцена 3
   * — закадровым нарратором. Оба источника нужны в одной фикстуре: правка
   * обязана попадать ровно в тот, откуда фраза в трек и пришла
   * (`mergeScriptLines` отдаёт приоритет реплике в кадре).
   */
  const sharedPlan = options.script === undefined
    ? {
        version: "1.0",
        scenes: [
          { order: 1, spokenLine: "первая", subtitleCopy: "первая" },
          { order: 2, spokenLine: "вторая", subtitleCopy: "вторая" },
          { order: 3, spokenLine: null, subtitleCopy: "третья" },
        ],
        voiceoverPlan: {
          enabled: true,
          lines: [{ sceneOrder: 3, text: "третья", emotion: "neutral", pauseAfter: "none" }],
        },
      } as Record<string, unknown>
    : options.script

  const world: World = {
    deps: null as unknown as ReplaceSegmentDeps,
    files,
    durations,
    steps,
    sharedPlan,
    overrides: null,
    calls,
    splicedDurationSec: options.splicedDurationSec ?? 20.95,
    spliceFails: false,
    transcribeFails: false,
    transcribeGivesNothing: false,
  }

  world.deps = {
    assetsDir: () => ASSETS_DIR,
    store: {
      loadVideo: async () => ({
        isLocked: false,
        voiceoverLanguage: "ru",
        voiceoverPacing: "moderate" as const,
        voiceoverVoiceId: "voice-1",
        voiceoverModelId: "minimax/speech-02-turbo",
      }),
      readStep: async (_videoId: number, stepKey: string) => steps.get(stepKey) ?? null,
      // Порт отдаёт ОБЩИЙ сценарий и правки ЭТОГО ролика отдельно — так же,
      // как боевая реализация читает вариант и колонку ролика.
      loadScript: async () => (world.sharedPlan
        ? { storyPlan: world.sharedPlan, overrides: world.overrides }
        : null),
      commit: async (
        updates: ReadonlyArray<{ stepId: number, snapshot: Record<string, unknown> }>,
        scriptPatch?: { videoId: number, overrides: unknown } | null,
      ) => {
        calls.commits.push({ stepIds: updates.map(update => update.stepId), withScript: !!scriptPatch })
        for (const update of updates) {
          for (const entry of steps.values()) {
            if (entry.id === update.stepId) entry.snapshot = update.snapshot
          }
        }
        // Правка пишется той же транзакцией, что и снапшоты: фейк обязан
        // повторять это свойство, иначе тест «одной транзакцией» ничего не ловит.
        // И пишется она в РОЛИК, а не в общий вариант — `sharedPlan` неприкасаем.
        if (scriptPatch) world.overrides = scriptPatch.overrides
      },
      appendLog: async (_stepId: number, message: string) => { calls.logs.push(message) },
      recordCost: async (input: { stepKey: string, costUsd: number }) => {
        calls.costs.push({ stepKey: input.stepKey, costUsd: input.costUsd })
      },
      resetShots: async (_videoId: number, sceneOrders: readonly number[]) => {
        if (options.resetShotsThrows) throw new Error("таблицы кадров ещё нет")
        calls.resetShots.push([...sceneOrders])
        return sceneOrders.length
      },
      saveTrackAsset: async (input: Record<string, unknown>) => { calls.assets.push(input) },
    },
    media: {
      fileExists: async (path: string) => files.has(path),
      removeFile: async (path: string) => { calls.removed.push(path); files.delete(path); durations.delete(path) },
      renameFile: async (from: string, to: string) => {
        const content = files.get(from)
        if (content === undefined) throw new Error(`нет файла ${from}`)
        files.delete(from)
        files.set(to, content)
        const duration = durations.get(from)
        durations.delete(from)
        if (duration !== undefined) durations.set(to, duration)
      },
      readJsonFile: async (path: string) => {
        const raw = files.get(path)
        return raw === undefined ? null : JSON.parse(raw)
      },
      writeJsonFile: async (path: string, value: unknown) => { files.set(path, JSON.stringify(value)) },
      probeDuration: async (path: string) => durations.get(path) ?? 0,
      detectSilence: async () => options.silences ?? [
        { startSec: 5, endSec: 6 },
        { startSec: 10, endSec: 11 },
      ],
      synthesize: async (input: Record<string, unknown>) => {
        calls.synthesize.push(input)
        const outputPath = input.outputPath as string
        files.set(outputPath, `phrase:${input.text}`)
        durations.set(outputPath, phraseDurationSec)
        return { audioPath: outputPath, durationSec: phraseDurationSec, costUsd: 0.07 }
      },
      insertPauses: async (path: string, pauses: readonly unknown[]) => ({
        path,
        durationSec: durations.get(path) ?? 0,
        skippedPauses: [...pauses] as never[],
        sourceDurationMeasureFailed: false,
        durationEstimated: false,
      }),
      splice: async (input: Record<string, unknown>) => {
        // Длительность ИСТОЧНИКА на момент вызова: по ней видно, не вклеиваем
        // ли мы фразу второй раз в уже склеенный трек.
        calls.splice.push({ ...input, sourceDurationSec: durations.get(input.trackPath as string) ?? 0 })
        if (world.spliceFails) throw new Error("ffmpeg упал на склейке")
        const outputPath = input.outputPath as string
        files.set(outputPath, "track-v2")
        durations.set(outputPath, world.splicedDurationSec)
      },
      transcribePhrase: async (input: Record<string, unknown>) => {
        calls.transcribe.push(input)
        if (world.transcribeFails) throw new Error("транскрипция фразы упала")
        if (world.transcribeGivesNothing) return { scene: null, costUsd: 0.005 }
        return {
          scene: {
            order: input.sceneOrder as number,
            startSec: 0,
            endSec: phraseDurationSec,
            words: [{ text: String(input.text), startSec: 0, endSec: phraseDurationSec, matched: true }],
          },
          costUsd: 0.005,
        }
      },
      uploadTrack: async (input: { path: string }) => {
        calls.upload.push(input.path)
        return {
          storageKey: STORAGE_KEY,
          fileSha256: "sha-склеенного-файла",
          columns: { storageKey: STORAGE_KEY, fileSha256: "sha-склеенного-файла" },
        }
      },
    },
  } as unknown as ReplaceSegmentDeps

  return world
}

function voiceoverSnapshotOf(world: World): Record<string, unknown> {
  return world.steps.get("voiceover_generation")!.snapshot as Record<string, unknown>
}

function alignedScenesOf(world: World): AlignedScene[] {
  return (world.steps.get("transcription")!.snapshot as { scenes: AlignedScene[] }).scenes
}

function lipSyncRecordsOf(world: World): Map<number, Record<string, unknown>> {
  const snapshot = world.steps.get("lip_sync_generation")!.snapshot as { scenes?: Array<Record<string, unknown>> }
  return new Map((snapshot.scenes ?? []).map(record => [record.sceneOrder as number, record]))
}

/**
 * Сценарий ГЛАЗАМИ ЭТОГО ролика: общий вариант плюс личные правки. Именно из
 * него полная перегенерация соберёт трек.
 */
function effectivePlanOf(world: World): Record<string, unknown> | null {
  return applyScriptOverrides(world.sharedPlan, world.overrides)
}

/** Реплика сцены в сценарии ролика — то, из чего трек соберут при полной перегенерации. */
function scriptSpokenLineOf(world: World, sceneOrder: number): string | null {
  const scenes = (effectivePlanOf(world)?.scenes ?? []) as Array<{ order: number, spokenLine: string | null }>
  return scenes.find(item => item.order === sceneOrder)?.spokenLine ?? null
}

/** Закадровая строка сцены в сценарии ролика. */
function scriptNarrationOf(world: World, sceneOrder: number): string | null {
  const plan = effectivePlanOf(world)?.voiceoverPlan as { lines?: Array<{ sceneOrder: number, text: string }> } | undefined
  return plan?.lines?.find(line => line.sceneOrder === sceneOrder)?.text ?? null
}

/** Реплика сцены в ОБЩЕМ варианте — то, что видят соседние ролики. */
function sharedSpokenLineOf(world: World, sceneOrder: number): string | null {
  const scenes = (world.sharedPlan?.scenes ?? []) as Array<{ order: number, spokenLine: string | null }>
  return scenes.find(item => item.order === sceneOrder)?.spokenLine ?? null
}

/** Ключ куска трека ровно так, как его считает lip-sync-runner. */
function segmentKey(sceneOrder: number, startSec: number, endSec: number, fingerprint: string): string {
  return segmentIdentity({ videoId: VIDEO_ID, sceneOrder, startSec, endSec, trackFingerprint: fingerprint })
}

describe("replaceVoiceoverSegment", () => {
  let world: World

  beforeEach(() => {
    world = makeWorld()
  })

  it("отказывает на ролике, который не собирали от звука", async () => {
    // Решение №2 хендоффа: маршрут начатого ролика не меняется задним числом.
    const legacy = makeWorld({ voiceoverSnapshot: { route: "legacy", mixedPath: "mix.mp3" } })

    await expect(replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 1, newText: "x" },
      legacy.deps,
    )).rejects.toThrow(/от звука/i)

    expect(legacy.calls.synthesize).toHaveLength(0)
    expect(legacy.calls.splice).toHaveLength(0)
  })

  it("пересобирает только сдвинувшиеся кадры", async () => {
    const before = lipSyncRecordsOf(world)
    const untouched = { ...before.get(1)! }

    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    expect(result.invalidatedSceneOrders).toEqual([2, 3])

    const after = lipSyncRecordsOf(world)
    // Кадр первой сцены не сдвинулся — второй раз платить за него нельзя.
    expect(after.get(1)).toEqual(untouched)
    expect(after.get(2)).toBeUndefined()
    expect(after.get(3)).toBeUndefined()
    // Файлы нетронутой сцены на месте, файлы сдвинувшихся снесены — иначе
    // lip-sync подставил бы готовый клип под уже другой звук.
    expect(world.files.has(`${ASSETS_DIR}/scene_0_lipsync.mp4`)).toBe(true)
    expect(world.files.has(`${ASSETS_DIR}/scene_1_lipsync.mp4`)).toBe(false)
    expect(world.files.has(`${ASSETS_DIR}/scene_1_track_aaa1.mp3`)).toBe(false)
    // Разбитая на части реплика: сносятся файлы КАЖДОЙ части.
    expect(world.files.has(`${ASSETS_DIR}/scene_2_part1_lipsync.mp4`)).toBe(false)
    expect(world.files.has(`${ASSETS_DIR}/scene_2_part1_track.mp3`)).toBe(false)
  })

  it("кусок несдвинувшейся сцены сохраняет свой ключ переиспользования", async () => {
    // Ловушка отпечатка: ключ куска считается по `trackFingerprint`, и подмена
    // его на sha склеенного файла обесценила бы куски ВСЕГО ролика — двадцать
    // сцен по ~$0.7 lip-sync вместо одной правки за ~$0.08.
    const keyBefore = segmentKey(1, 0, 5, FINGERPRINT)

    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    const first = alignedScenesOf(world).find(item => item.order === 1)!
    expect(segmentKey(1, first.startSec, first.endSec, result.trackFingerprint)).toBe(keyBefore)

    // А у сдвинувшейся сцены ключ обязан стать другим: её звук теперь в другом
    // месте трека, и старый кусок под неё не подходит.
    const third = alignedScenesOf(world).find(item => item.order === 3)!
    expect(segmentKey(3, third.startSec, third.endSec, result.trackFingerprint))
      .not.toBe(segmentKey(3, 11, 20, FINGERPRINT))
  })

  it("в таймлайне после замены нет дыр", async () => {
    await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    const scenes = alignedScenesOf(world)
    expect(scenes).toHaveLength(3)
    for (let i = 1; i < scenes.length; i += 1) {
      expect(scenes[i]!.startSec).toBeGreaterThanOrEqual(scenes[i - 1]!.endSec - 1e-6)
    }
  })

  it("длительность трека измерена, а не выведена сложением", async () => {
    // Решение №5 хендоффа: трек — эталон времени, врать нельзя даже на
    // миллисекунды. Аналитика здесь дала бы 20.96 (20 + 6 − 5 − 0.02×2),
    // а ffprobe отвечает 20.95 — в снапшот обязано уйти измерение.
    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    expect(result.trackDurationSec).toBeCloseTo(20.95, 6)
    expect(voiceoverSnapshotOf(world).durationSec).toBeCloseTo(20.95, 6)
    expect(result.deltaSec).toBeCloseTo(0.95, 6)
  })

  it("длительность исходного трека тоже меряется, а не берётся из снапшота", async () => {
    // В снапшоте она могла оказаться ОЦЕНКОЙ (`durationEstimated` шага
    // озвучки). От неё зависят и точка реза, и наличие хвоста у склейки —
    // поверив записанному, раннер посчитал бы дельту от выдуманной длины.
    const stale = makeWorld({ snapshotDurationSec: 999 })

    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      stale.deps,
    )

    expect(result.deltaSec).toBeCloseTo(0.95, 6)
  })

  it("неизмеримая склейка не заменяет трек", async () => {
    // `probeAudioDuration` при ошибке ffprobe возвращает 0, а не бросает:
    // принятый за длину трека ноль сдвинул бы весь хвост ролика в минус.
    const broken = makeWorld({ splicedDurationSec: 0 })

    await expect(replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      broken.deps,
    )).rejects.toThrow(/длительност/i)

    // Трек ролика остался прежним, снапшот не тронут, огрызок подчищен.
    expect(voiceoverSnapshotOf(broken).trackPath).toBe(TRACK)
    expect(voiceoverSnapshotOf(broken).durationSec).toBe(20)
    expect(broken.files.get(TRACK)).toBe("track-v1")
    expect([...broken.files.keys()].some(path => path.includes(".tmp-"))).toBe(false)
    expect(lipSyncRecordsOf(broken).size).toBe(3)
  })

  it("повторный вызов с тем же текстом не платит второй раз", async () => {
    const first = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Одинаковый текст." },
      world.deps,
    )
    const second = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Одинаковый текст." },
      world.deps,
    )

    expect(second.costUsd).toBe(0)
    expect(second.trackFingerprint).toBe(first.trackFingerprint)
    expect(second.reused).toBe(true)
    expect(world.calls.synthesize).toHaveLength(1)
    expect(world.calls.transcribe).toHaveLength(1)
    expect(world.calls.splice).toHaveLength(1)
  })

  it("заход после падения посреди работы не платит за синтез второй раз", async () => {
    world.spliceFails = true
    await expect(replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )).rejects.toThrow(/ffmpeg/i)

    // Расход синтеза записан ДО броска: отказ шага не теряет уже потраченные деньги.
    expect(world.calls.costs).toContainEqual({ stepKey: "voiceover_generation", costUsd: 0.07 })

    world.spliceFails = false
    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    expect(world.calls.synthesize).toHaveLength(1)
    expect(result.costUsd).toBeCloseTo(0.005, 6)
    expect(result.trackDurationSec).toBeCloseTo(20.95, 6)
  })

  it("заход после падения транскрипции не пересклеивает трек поверх склеенного", async () => {
    // Самый опасный обрыв: файл склеен, а снапшот ещё не записан. Источником
    // склейки обязан остаться ПРЕЖНИЙ трек — иначе фраза встала бы в ролик дважды.
    world.transcribeFails = true
    await expect(replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )).rejects.toThrow(/транскрипц/i)

    world.transcribeFails = false
    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    expect(world.calls.splice.map(call => call.trackPath)).toEqual([TRACK, TRACK])
    // И источник обеих склеек — трек ПРЕЖНЕЙ длины: вклейся фраза в уже
    // склеенное, второй вызов увидел бы 20.95 и ролик получил бы её дважды.
    expect(world.calls.splice.map(call => call.sourceDurationSec)).toEqual([20, 20])
    expect(result.trackDurationSec).toBeCloseTo(20.95, 6)
  })

  it("транскрипция без границ роняет замену, но расход остаётся записанным", async () => {
    // Провайдер ответил и деньги списаны — вклеить кусок без границ слов нельзя
    // (он остался бы без субтитров и без интервала для lip-sync), но и терять
    // уже потраченное на молчаливом отказе нельзя.
    world.transcribeGivesNothing = true

    await expect(replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )).rejects.toThrow(/границ слов/i)

    expect(world.calls.costs).toContainEqual({ stepKey: "transcription", costUsd: 0.005 })
    expect(voiceoverSnapshotOf(world).trackPath).toBe(TRACK)
  })

  it("склеенный трек уезжает в хранилище под тем же ключом", async () => {
    // Иначе рестарт восстановит из хранилища СТАРЫЙ трек: `restoreTrackFile`
    // тянет файл по storageKey из снапшота.
    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    expect(world.calls.upload).toEqual([result.trackPath])
    // Заливается именно готовый файл: без переименования из временного по этому
    // пути лежал бы пустой путь, а в хранилище уехал бы огрызок.
    expect(world.files.has(result.trackPath)).toBe(true)
    expect(voiceoverSnapshotOf(world).storageKey).toBe(STORAGE_KEY)
    expect(world.calls.assets).toHaveLength(1)
  })

  it("повтор доливает трек в хранилище, если заливка не доехала", async () => {
    // Заливка идёт ПОСЛЕ фиксации снапшотов, и обрыв между ними оставил бы в
    // хранилище прежний трек: после рестарта `restoreTrackFile` вернул бы на
    // диск СТАРЫЙ звук. Повтор обязан это доделать, а не отчитаться «уже готово».
    const first = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Одинаковый текст." },
      world.deps,
    )
    const snapshot = voiceoverSnapshotOf(world)
    snapshot.spliceHistory = (snapshot.spliceHistory as Array<Record<string, unknown>>)
      .map(entry => ({ ...entry, uploaded: false }))
    world.calls.upload.length = 0

    const second = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Одинаковый текст." },
      world.deps,
    )

    expect(second.reused).toBe(true)
    expect(world.calls.upload).toEqual([first.trackPath])
    expect((voiceoverSnapshotOf(world).spliceHistory as Array<Record<string, unknown>>)[0]!.uploaded).toBe(true)
  })

  it("транскрипция шага получает новые границы под ТЕМ ЖЕ отпечатком", async () => {
    // Кэш шага транскрипции привязан к отпечатку трека. Разойдись он с
    // отпечатком озвучки — следующий прогон оплатил бы разметку всего трека
    // заново ради границ, которые уже посчитаны арифметикой.
    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    const snapshot = world.steps.get("transcription")!.snapshot as { trackFingerprint: string, scenes: AlignedScene[] }
    expect(snapshot.trackFingerprint).toBe(result.trackFingerprint)
    expect(snapshot.scenes.find(item => item.order === 2)!.words[0]!.text).toContain("Новая")
  })

  it("текст сцены в снапшоте озвучки обновлён", async () => {
    await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    const scenes = voiceoverSnapshotOf(world).scenes as Array<{ order: number, text: string }>
    expect(scenes.find(item => item.order === 2)!.text).toBe("Новая формулировка.")
    expect(scenes.find(item => item.order === 1)!.text).toBe("первая")
  })

  it("новый текст уезжает в сценарий, а не только в трек", async () => {
    // Трек — производная сценария, а не источник истины: полная перегенерация
    // (`runAudioFirstVoiceover`) собирает его заново из `storyPlan.scenes[].spokenLine`.
    // Оставь мы сценарий прежним — первая же перегенерация молча вернула бы
    // СТАРУЮ фразу и стёрла правку оператора, за которую он уже заплатил.
    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    expect(scriptSpokenLineOf(world, 2)).toBe("Новая формулировка.")
    expect(result.scriptUpdated).toBe("spoken")
    // Соседние сцены сценария не трогаются вовсе.
    expect(scriptSpokenLineOf(world, 1)).toBe("первая")
  })

  it("правка уезжает в РОЛИК, а общий вариант остаётся прежним", async () => {
    // Вариант сценария делится между роликами: `Video.variantId` уникальности
    // не даёт. Пиши замена в `ScenarioVariant.storyPlan` — правка одной фразы
    // меняла бы текст соседнему ролику, уже снятому или снимающемуся, и тот
    // при первой перегенерации оплатил бы чужой текст.
    await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    expect(sharedSpokenLineOf(world, 2)).toBe("вторая")
    // А сам ролик видит новый текст — через личные правки.
    expect(world.overrides).not.toBeNull()
    expect(scriptSpokenLineOf(world, 2)).toBe("Новая формулировка.")
  })

  it("правка сцены нарратора уходит в закадровую строку, а не в реплику ведущего", async () => {
    // `mergeScriptLines` берёт закадровую строку только когда реплики в кадре
    // нет. Запиши мы новый текст в `spokenLine` такой сцены — ролик получил бы
    // говорящего в кадре ведущего там, где его не было, и оплатил бы lip-sync.
    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 3, newText: "Новая закадровая." },
      world.deps,
    )

    expect(scriptNarrationOf(world, 3)).toBe("Новая закадровая.")
    expect(scriptSpokenLineOf(world, 3)).toBeNull()
    expect(result.scriptUpdated).toBe("narration")
  })

  it("сценарий и снапшоты фиксируются одной транзакцией", async () => {
    // Разъехавшись, они дали бы трек с новой фразой и сценарий со старой:
    // следующая полная перегенерация вернула бы старый текст, и оператор
    // увидел бы откат правки, за которую заплатил.
    await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    // Фиксация замены — та, что несёт снапшот озвучки (id 101) с историей вклеек.
    const fixation = world.calls.commits.find(commit => commit.stepIds.includes(101) && commit.stepIds.length > 1)
    expect(fixation).toBeDefined()
    expect(fixation!.withScript).toBe(true)
    // Отдельной записи сценария быть не должно: она и есть «разъехались».
    expect(world.calls.commits.filter(commit => commit.withScript)).toHaveLength(1)
  })

  it("ролик без сценария меняет фразу, но оператор об этом предупреждён", async () => {
    // Legacy-ролик или отвязанный вариант: писать новый текст некуда. Замена
    // при этом законна (трек-то есть), а вот молчать нельзя — оператор обязан
    // знать, что его правка живёт только в треке.
    const orphan = makeWorld({ script: null })

    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      orphan.deps,
    )

    expect(result.scriptUpdated).toBeNull()
    expect(result.warnings.some(text => /сценар/i.test(text))).toBe(true)
    expect(result.trackDurationSec).toBeCloseTo(20.95, 6)
  })

  it("повтор дописывает текст в сценарий, если он туда не доехал", async () => {
    // Замена могла быть сделана прошлой версией кода (история вклеек есть,
    // сценарий не тронут). Повтор ничего не оплачивает, но и оставлять
    // сценарий со старой фразой не имеет права — это та же дыра.
    await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Одинаковый текст." },
      world.deps,
    )
    // Правка «не доехала»: история вклеек есть, а личных правок у ролика нет.
    world.overrides = null

    const second = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Одинаковый текст." },
      world.deps,
    )

    expect(second.reused).toBe(true)
    expect(second.costUsd).toBe(0)
    expect(scriptSpokenLineOf(world, 2)).toBe("Одинаковый текст.")
  })

  it("кадры сдвинувшихся сцен уходят в planned, чужие не трогаются", async () => {
    await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      world.deps,
    )

    expect(world.calls.resetShots).toEqual([[2, 3]])
  })

  it("отсутствие таблицы кадров не роняет уже оплаченную замену", async () => {
    const noShots = makeWorld({ resetShotsThrows: true })

    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      noShots.deps,
    )

    expect(result.invalidatedSceneOrders).toEqual([2, 3])
    expect(result.warnings.some(text => /кадр/i.test(text))).toBe(true)
  })

  it("предупреждает, когда рез идёт не по тишине", async () => {
    // Пауз рядом с границами сцены нет — режем по концу слова, и стык может
    // быть слышен. Молчать об этом нельзя: брак вскроется только на просмотре.
    const noSilence = makeWorld({ silences: [] })

    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      noSilence.deps,
    )

    expect(result.warnings.some(text => /тишин/i.test(text))).toBe(true)
  })

  it("предупреждает, когда измеренная склейка разошлась с моделью кроссфейда", async () => {
    // Модель `acrossfade` выведена рассуждением, живым ffmpeg не подтверждена
    // (отчёт Task 2). Расхождение больше кадра — повод сказать вслух.
    const drifted = makeWorld({ splicedDurationSec: 21.6 })

    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      drifted.deps,
    )

    expect(result.warnings.some(text => /кроссфейд/i.test(text))).toBe(true)
  })

  it("маркер паузы в новом тексте не читается вслух и виден в ответе", async () => {
    // Хвост Task 4: `insertVoiceoverPauses` отдаёт пропущенные паузы и признаки
    // неизмеренной длительности — их обязан видеть оператор, а не только лог.
    const result = await replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая фраза. [пауза 2с]" },
      world.deps,
    )

    expect(world.calls.synthesize[0]!.text).toBe("Новая фраза.")
    expect(result.skippedPauses).toHaveLength(1)
    expect(result.sourceDurationMeasureFailed).toBe(false)
    expect(result.durationEstimated).toBe(false)
  })

  it("отказывается вклеивать, когда точки реза нет", async () => {
    // Сцена целиком за концом трека: `planSegmentSplice` отдаёт null, и резать
    // наугад нельзя — вклейка снесла бы кусок соседней реплики.
    const outside = makeWorld({
      alignedScenes: [scene(1, 0, 5, "первая"), scene(2, 40, 45, "вторая")],
    })

    await expect(replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "Новая формулировка." },
      outside.deps,
    )).rejects.toThrow(/вклеи/i)

    expect(outside.files.get(TRACK)).toBe("track-v1")
  })

  it("отказывает, когда сцены нет в выравнивании", async () => {
    await expect(replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 9, newText: "Новая формулировка." },
      world.deps,
    )).rejects.toThrow(/сцен/i)

    expect(world.calls.synthesize).toHaveLength(0)
  })

  it("отказывает на пустом тексте до любого платного вызова", async () => {
    await expect(replaceVoiceoverSegment(
      { videoId: VIDEO_ID, sceneOrder: 2, newText: "   " },
      world.deps,
    )).rejects.toThrow(/текст/i)

    expect(world.calls.synthesize).toHaveLength(0)
  })
})

/**
 * Разбор запроса ручки вынесен в чистую функцию: правила «кому можно» и «в
 * каком состоянии ролика можно» обязаны проверяться без Nitro и без БД, а сам
 * обработчик остаётся тонким (AGENTS.md — длинного pipeline в эндпоинте быть
 * не должно).
 */
describe("planReplaceSegmentRequest", () => {
  const video = { status: "completed", isLocked: false }

  it("принимает корректный запрос", () => {
    const result = planReplaceSegmentRequest({
      id: 44,
      body: { sceneOrder: 2, newText: "Новая формулировка." },
      video,
    })

    expect(result).toEqual({
      ok: true,
      videoId: 44,
      sceneOrder: 2,
      newText: "Новая формулировка.",
      // Досмотренный ролик после замены уходит в пересборку: завершённые шаги
      // прогон поднимет из снапшотов, пересоберётся только инвалидированное.
      resumePipeline: true,
      nextStatus: "pending",
    })
  })

  it("ролик, ждущий решения оператора, править можно", () => {
    // `awaiting_operator` — это остановленный ролик: шаг доведён до конца,
    // блокировка отпущена, процесса нет. Отказ заставил бы оператора сначала
    // нажать «принять» (то есть оплатить следующие шаги) только ради того,
    // чтобы поправить фразу, — деньги ровно за то, чего он не просил.
    const result = planReplaceSegmentRequest({
      id: 44,
      body: { sceneOrder: 2, newText: "Новая формулировка." },
      video: { status: "awaiting_operator", isLocked: false },
    })

    expect(result).toMatchObject({ ok: true, videoId: 44, sceneOrder: 2 })
  })

  it("замена на ролике в ожидании не запускает прогон за оператора", () => {
    // Продолжение — это решение оператора и только его («принять»). Переведи
    // ручка такой ролик в `pending` и запусти прогон, правка одной фразы молча
    // сняла бы пошаговый режим и оплатила бы шаги, которых никто не принимал.
    const result = planReplaceSegmentRequest({
      id: 44,
      body: { sceneOrder: 2, newText: "Новая формулировка." },
      video: { status: "awaiting_operator", isLocked: false },
    })

    expect(result).toMatchObject({ ok: true, resumePipeline: false, nextStatus: "awaiting_operator" })
  })

  it("отбивает некорректный id видео", () => {
    expect(planReplaceSegmentRequest({ id: Number.NaN, body: { sceneOrder: 1, newText: "x" }, video }))
      .toMatchObject({ ok: false, statusCode: 400 })
  })

  it("отбивает нецелый номер сцены", () => {
    expect(planReplaceSegmentRequest({ id: 44, body: { sceneOrder: 1.5, newText: "x" }, video }))
      .toMatchObject({ ok: false, statusCode: 400 })
  })

  it("отбивает пустой текст", () => {
    expect(planReplaceSegmentRequest({ id: 44, body: { sceneOrder: 1, newText: "   " }, video }))
      .toMatchObject({ ok: false, statusCode: 400 })
  })

  it("отдаёт 404 на несуществующем ролике", () => {
    expect(planReplaceSegmentRequest({ id: 44, body: { sceneOrder: 1, newText: "x" }, video: null }))
      .toMatchObject({ ok: false, statusCode: 404 })
  })

  it("отдаёт 409 на заблокированном ролике", () => {
    // Идёт прогон: он держит блокировку и в этот же трек пишет. Замена сегмента
    // посреди прогона разошлась бы со снапшотами шагов.
    expect(planReplaceSegmentRequest({
      id: 44,
      body: { sceneOrder: 1, newText: "x" },
      video: { status: "assembling", isLocked: true },
    })).toMatchObject({ ok: false, statusCode: 409 })
  })

  it("отдаёт 400 на ролике, который ещё генерируется", () => {
    expect(planReplaceSegmentRequest({
      id: 44,
      body: { sceneOrder: 1, newText: "x" },
      video: { status: "generating_clips", isLocked: false },
    })).toMatchObject({ ok: false, statusCode: 400 })
  })
})
