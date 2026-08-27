/**
 * Локальная замена одной фразы в готовом треке озвучки (spec §4.5).
 *
 * Оператор правит одну реплику — пересинтезируется ТОЛЬКО она, вклеивается в
 * трек по паузам, а пересобираются только те кадры, чьи границы реально
 * сдвинулись. Остальные кадры и их lip-sync остаются оплаченными один раз:
 * TTS одной фразы стоит ~$0.07, lip-sync одной сцены ~$0.7, и полный
 * пересинтез трека превратил бы правку слова в новый ролик.
 *
 * ─── Отпечаток трека: почему он НЕ меняется ───────────────────────────────
 *
 * Ключ переиспользования куска (`segmentIdentity`) считается по `videoId`,
 * границам сцены и `trackFingerprint`. Отпечаток изначально был sha256 ФАЙЛА
 * трека, и это правильно для ПОЛНОГО пересинтеза: новый трек звучит иначе
 * везде, поэтому обесцениться обязаны все куски.
 *
 * Локальная вклейка — не полный пересинтез. Она меняет звук в ОДНОМ интервале,
 * а байты остального трека остаются теми же. Подставь мы сюда sha склеенного
 * файла — ключи ВСЕХ сцен стали бы другими, и ролик из двадцати сцен переоплатил
 * бы lip-sync целиком (~$14 вместо ~$0.8) ровно там, где ничего не изменилось.
 * Честный список сдвинувшихся сцен от `shiftAlignmentAfterSplice` при этом
 * работал бы вхолостую.
 *
 * Поэтому `trackFingerprint` здесь трактуется как отпечаток СОДЕРЖИМОГО
 * ИНТЕРВАЛОВ, а не файла: он меняется тогда и только тогда, когда звук мог
 * измениться везде. Локальная вклейка его сохраняет, а корректность
 * обеспечивает адресно:
 *
 *  - у сцены, уехавшей по таймлайну, меняются притянутые к кадру границы —
 *    значит меняется и ключ, и кусок режется заново из нового трека;
 *  - у сцен из `movedSceneOrders` (включая заменённую, у которой границы могли
 *    совпасть до кадра) сносятся запись в снапшоте lip-sync И её файлы — иначе
 *    шаг подставил бы готовый клип под уже другой звук;
 *  - сцены вне списка не трогаются вовсе. Это и есть смысл задачи.
 *
 * Настоящая sha склеенного файла не теряется: она пишется в снапшот отдельным
 * полем `trackFileSha256` и в колонку `VideoAsset.fileSha256`, где и означает
 * «байты файла». Историю вклеек видно в `spliceHistory`.
 *
 * ─── Идемпотентность ──────────────────────────────────────────────────────
 *
 * Платных вызова два: синтез фразы и транскрипция этой же фразы. Оба
 * содержат результат в файле с контент-адресным именем (ключ вклейки — хэш от
 * `videoId`, сцены, текста, голоса, модели, языка, темпа и отпечатка трека),
 * поэтому повторный заход после рестарта процесса поднимает готовое с диска и
 * второй раз не платит. Сама вклейка пишет в НОВЫЙ файл, а не поверх трека:
 * обрыв между склейкой и записью снапшота оставляет источником прежний трек,
 * и повтор не вклеивает фразу второй раз в уже склеенный трек.
 *
 * Снапшоты трёх шагов (озвучка, транскрипция, lip-sync) пишутся ОДНОЙ
 * транзакцией: разъехавшись, они дали бы склеенный трек со старым
 * выравниванием — субтитры и нарезка кусков указывали бы на звук, которого в
 * треке уже нет.
 *
 * ─── Порты вместо прямых вызовов ──────────────────────────────────────────
 *
 * БД, ffmpeg, TTS и транскрипция приходят зависимостями (`store`, `media`) —
 * так проверяется вся денежная логика без единого платного вызова и без БД.
 * Боевые реализации собирает `createReplaceSegmentDeps()` ниже; тяжёлые модули
 * там подтягиваются динамическим импортом, чтобы этот файл оставался
 * пригодным для чистой сьюты.
 */

import { createHash } from "node:crypto"
import { join } from "node:path"
import { TIMELINE_FPS } from "~~/shared/types/video-runtime"
import { getAssetsDirFor } from "../storage-paths"
import type { AlignedScene, AlignScene } from "../transcription/align"
import type { SilenceRange } from "../video-tools/silence-detect"
import type { InsertPausesResult } from "./insert-pauses"
import { shiftAlignmentAfterSplice } from "./alignment-shift"
import { buildSpliceFilters, planSegmentSplice } from "./segment-splice"
import { buildTempSegmentPath, renameWithRetry } from "./segment-cut"
import { buildTrackRequest, type TrackPause } from "./track-builder"
import { planScriptTextPatch, type ScriptTextTarget } from "./script-patch"
import { AWAITING_OPERATOR_STATUS } from "../video-pipeline-stepwise"

/** Ключи шагов, снапшоты которых читает и переписывает замена. */
export type ReplaceSegmentStepKey = "voiceover_generation" | "transcription" | "lip_sync_generation"

export interface ReplaceSegmentInput {
  videoId: number
  sceneOrder: number
  newText: string
}

export interface ReplaceSegmentResult {
  trackPath: string
  /** Измерена ffprobe на склеенном файле, а не выведена сложением (решение №5). */
  trackDurationSec: number
  trackFingerprint: string
  deltaSec: number
  /** Сцены, чьи кадры обязаны быть пересобраны. Остальные оплачены один раз. */
  invalidatedSceneOrders: number[]
  /** Сколько потратил ЭТОТ заход. Повтор уже сделанной замены — ноль. */
  costUsd: number
  /** Замена уже была выполнена раньше: ничего не пересчитывалось и не оплачивалось. */
  reused: boolean
  /** Паузы нового текста, для которых не нашлось точки вставки (§4.6). */
  skippedPauses: TrackPause[]
  /** Не удалось измерить фразу до вставки пауз — тишина не вставлена вовсе. */
  sourceDurationMeasureFailed: boolean
  /** Длительность фразы — оценка, а не измерение готового файла. */
  durationEstimated: boolean
  /**
   * Куда лёг новый текст в сценарии ролика. `null` — писать было некуда
   * (нет варианта или нет сцены), и об этом сказано в `warnings`.
   */
  scriptUpdated: ScriptTextTarget | null
  /** То, о чём оператор обязан узнать, но из-за чего не стоит отменять замену. */
  warnings: string[]
}

export interface ReplaceSegmentVideo {
  isLocked: boolean
  voiceoverLanguage: string
  voiceoverPacing: "slow" | "moderate" | "fast"
  voiceoverVoiceId: string | null
  voiceoverModelId: string | null
}

export interface ReplaceSegmentStepRecord {
  id: number
  status: string
  snapshot: Record<string, unknown> | null
}

export interface StepSnapshotUpdate {
  stepId: number
  snapshot: Record<string, unknown>
}

/** Сценарий ролика с новым текстом реплики — пишется вместе со снапшотами. */
export interface ScriptPatchUpdate {
  variantId: number
  storyPlan: Record<string, unknown>
}

export interface SegmentReplaceStore {
  loadVideo: (videoId: number) => Promise<ReplaceSegmentVideo | null>
  readStep: (videoId: number, stepKey: ReplaceSegmentStepKey) => Promise<ReplaceSegmentStepRecord | null>
  /**
   * Сценарий ролика: `null` — варианта нет или он без `storyPlan` (legacy).
   * Именно отсюда полная перегенерация собирает трек заново.
   */
  loadScript: (videoId: number) => Promise<{ variantId: number, storyPlan: unknown } | null>
  /**
   * Атомарная запись снапшотов И сценария. Именно атомарная: склеенный трек со
   * старым выравниванием — это субтитры и куски по звуку, которого в треке нет,
   * а новый трек при старом сценарии — правка, которую первая же полная
   * перегенерация молча отменит.
   */
  commit: (updates: readonly StepSnapshotUpdate[], script?: ScriptPatchUpdate | null) => Promise<void>
  appendLog: (stepId: number, message: string) => Promise<void>
  /** Расход пишется СРАЗУ после платного вызова: отказ ниже не теряет деньги. */
  recordCost: (input: {
    videoId: number
    stepId: number
    stepKey: string
    costUsd: number
    modelId: string | null
  }) => Promise<void>
  /** Кадры сдвинувшихся сцен — обратно в planned. Возвращает, сколько задето. */
  resetShots: (videoId: number, sceneOrders: readonly number[]) => Promise<number>
  saveTrackAsset: (input: {
    videoId: number
    trackPath: string
    durationSec: number
    storage: Record<string, unknown>
  }) => Promise<void>
}

export interface SegmentReplaceMedia {
  fileExists: (path: string) => Promise<boolean>
  removeFile: (path: string) => Promise<void>
  renameFile: (from: string, to: string) => Promise<void>
  readJsonFile: <T>(path: string) => Promise<T | null>
  writeJsonFile: (path: string, value: unknown) => Promise<void>
  /** ffprobe. Ноль означает «не измерено» — эта функция не бросает. */
  probeDuration: (path: string) => Promise<number>
  detectSilence: (path: string) => Promise<readonly SilenceRange[]>
  synthesize: (input: {
    videoId: number
    text: string
    outputPath: string
    modelId: string | null
    voiceId: string | null
    language: string
    pacing: "slow" | "moderate" | "fast"
  }) => Promise<{ audioPath: string, durationSec: number, costUsd: number }>
  insertPauses: (
    path: string,
    pauses: readonly TrackPause[],
    scenes: readonly AlignScene[],
    synthDurationSec: number,
  ) => Promise<InsertPausesResult>
  splice: (input: {
    trackPath: string
    phrasePath: string
    filters: string[]
    outputPath: string
  }) => Promise<void>
  /**
   * Транскрипция ТОЛЬКО новой фразы. `scene: null` — провайдер ответил (и
   * деньги списаны), но границ из ответа не вышло: стоимость всё равно обязана
   * вернуться наружу, поэтому это не исключение, а честный ноль результата.
   */
  transcribePhrase: (input: {
    videoId: number
    stepId: number
    audioPath: string
    text: string
    sceneOrder: number
    language: string
    outputPath: string
  }) => Promise<{ scene: AlignedScene | null, costUsd: number }>
  uploadTrack: (input: { videoId: number, path: string }) => Promise<{
    storageKey: string | null
    fileSha256: string | null
    columns: Record<string, unknown>
  }>
}

export interface ReplaceSegmentDeps {
  store: SegmentReplaceStore
  media: SegmentReplaceMedia
  /** Каталог ассетов ролика. Не передан — боевой путь хранилища. */
  assetsDir?: (videoId: number) => string
  fps?: number
}

/** Трек ролика из снапшота шага озвучки. */
interface AudioFirstTrack {
  trackPath: string
  durationSec: number
  trackFingerprint: string
  storageKey: string | null
  scenes: AlignScene[]
}

/** Запись о выполненной вклейке — она же признак «повторно платить не за что». */
interface SpliceHistoryEntry {
  key: string
  sceneOrder: number
  at: string
  trackPath: string
  deltaSec: number
  invalidatedSceneOrders: number[]
  skippedPauses: TrackPause[]
  sourceDurationMeasureFailed: boolean
  durationEstimated: boolean
  warnings: string[]
  /** Залит ли склеенный трек в хранилище. Заливка идёт ПОСЛЕ фиксации снапшотов. */
  uploaded: boolean
  fileSha256: string | null
}

/**
 * Читатель снапшота озвучки — свой, а не импортированный из
 * `video-pipeline-steps`: тот модуль тянет prisma и половину конвейера, а этот
 * обязан оставаться проверяемым без БД. Формат один и тот же
 * (`route: "audio_first"`), и признак маршрута тот же: снапшот-отказ трека не
 * содержит и заменять в нём нечего.
 */
function readAudioFirstTrack(snapshot: unknown): AudioFirstTrack | null {
  const value = snapshot as Record<string, unknown> | null
  if (!value || value.route !== "audio_first") return null
  const trackPath = typeof value.trackPath === "string" ? value.trackPath : ""
  const fingerprint = typeof value.trackFingerprint === "string" ? value.trackFingerprint : ""
  if (!trackPath || !fingerprint) return null
  return {
    trackPath,
    durationSec: typeof value.durationSec === "number" ? value.durationSec : 0,
    trackFingerprint: fingerprint,
    storageKey: typeof value.storageKey === "string" ? value.storageKey : null,
    scenes: Array.isArray(value.scenes) ? (value.scenes as AlignScene[]) : [],
  }
}

function readSpliceHistory(snapshot: unknown): SpliceHistoryEntry[] {
  const value = snapshot as Record<string, unknown> | null
  const history = value?.spliceHistory
  return Array.isArray(history) ? (history as SpliceHistoryEntry[]) : []
}

function readAlignedScenes(snapshot: unknown): AlignedScene[] {
  const value = snapshot as Record<string, unknown> | null
  const scenes = value?.scenes
  return Array.isArray(scenes) ? (scenes as AlignedScene[]) : []
}

/**
 * Файлы записи сцены в снапшоте lip-sync: сам клип, его звук и то же самое по
 * каждой части разбитой реплики. Имя куска трека контент-адресное, и
 * `ensureTrackSegment` переиспользует его по факту существования файла —
 * оставленный на диске кусок подставился бы под уже другой звук.
 */
function recordFiles(record: Record<string, unknown>): string[] {
  const paths: string[] = []
  const push = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0) paths.push(value)
  }
  push(record.outputPath)
  push(record.audioPath)
  const parts = Array.isArray(record.parts) ? (record.parts as Array<Record<string, unknown>>) : []
  for (const part of parts) {
    push(part.outputPath)
    push(part.audioPath)
  }
  return [...new Set(paths)]
}

/**
 * Заливка склеенного трека в хранилище и обновление ассета.
 *
 * Идёт ПОСЛЕ фиксации снапшотов и отмечается в истории флагом `uploaded`:
 * обрыв между фиксацией и заливкой оставил бы в хранилище прежний трек, и
 * `restoreTrackFile` после рестарта вернул бы на диск СТАРЫЙ звук. Повторный
 * заход видит незакрытый флаг и доливает файл, вместо того чтобы молча
 * отчитаться «уже сделано».
 */
async function publishTrack(
  deps: ReplaceSegmentDeps,
  input: {
    videoId: number
    stepId: number
    trackPath: string
    durationSec: number
    snapshot: Record<string, unknown>
    entryKey: string
  },
): Promise<void> {
  const uploaded = await deps.media.uploadTrack({ videoId: input.videoId, path: input.trackPath })
  await deps.store.saveTrackAsset({
    videoId: input.videoId,
    trackPath: input.trackPath,
    durationSec: input.durationSec,
    storage: uploaded.columns,
  })

  const history = readSpliceHistory(input.snapshot).map(entry => (
    entry.key === input.entryKey
      ? { ...entry, uploaded: true, fileSha256: uploaded.fileSha256 }
      : entry
  ))
  const snapshot: Record<string, unknown> = {
    ...input.snapshot,
    storageKey: uploaded.storageKey ?? input.snapshot.storageKey ?? null,
    trackFileSha256: uploaded.fileSha256,
    spliceHistory: history,
  }
  await deps.store.commit([{ stepId: input.stepId, snapshot }])
}

export async function replaceVoiceoverSegment(
  input: ReplaceSegmentInput,
  deps: ReplaceSegmentDeps,
): Promise<ReplaceSegmentResult> {
  const { media, store } = deps
  const { sceneOrder, videoId } = input
  const fps = deps.fps ?? TIMELINE_FPS
  const warnings: string[] = []

  const rawText = (input.newText ?? "").trim()
  if (!rawText) {
    throw new Error("Замена фразы: пустой текст — синтезировать нечего")
  }

  const video = await store.loadVideo(videoId)
  if (!video) throw new Error(`Замена фразы: видео ${videoId} не найдено`)
  if (video.isLocked) {
    throw new Error(`Замена фразы: видео ${videoId} заблокировано — идёт прогон, трек трогать нельзя`)
  }

  // Маркеры пауз (§4.6) вынимаются из текста ДО синтеза: модель прочитала бы
  // «пауза два эс» вслух. Тишина вставляется в файл фразы ниже.
  const request = buildTrackRequest([{ order: sceneOrder, text: rawText, source: "spoken" }])
  const phraseText = request.scenes[0]?.text ?? ""
  if (!phraseText) {
    throw new Error("Замена фразы: в тексте нет ничего, кроме маркеров пауз")
  }

  // Гейт маршрута (решение №2 хендоффа): маршрут начатого ролика не меняется
  // задним числом. Нет единого трека — нечего и заменять.
  const voiceoverStep = await store.readStep(videoId, "voiceover_generation")
  const track = readAudioFirstTrack(voiceoverStep?.snapshot)
  if (!voiceoverStep || !track) {
    throw new Error(
      `Замена фразы: видео ${videoId} не собирали от звука — единого трека нет, `
      + "локальная замена работает только на маршруте «монтаж от звука»",
    )
  }

  // Голос и модель берутся из снапшота трека, а не из ролика: вклеиваемая фраза
  // обязана звучать ТЕМ ЖЕ голосом, которым трек уже спет. Настройки ролика
  // могли поменяться после синтеза, и чужой голос в середине трека — брак.
  const modelId = (voiceoverStep.snapshot?.modelId as string | null) ?? video.voiceoverModelId
  const voiceId = (voiceoverStep.snapshot?.voiceId as string | null) ?? video.voiceoverVoiceId

  // Сценарий ролика. Трек — его производная: полная перегенерация собирает
  // трек заново из `storyPlan`, поэтому правка, не доехавшая до сценария,
  // живёт до первой же перегенерации и потом молча откатывается.
  //
  // Отказом это НЕ является: у legacy-ролика сценария может не быть вовсе, а
  // трек при этом есть и правится законно. Но промолчать нельзя — оператор
  // обязан знать, что его правка живёт только в треке.
  const script = await store.loadScript(videoId)
  const scriptPatch = script
    ? planScriptTextPatch({ storyPlan: script.storyPlan, sceneOrder, newText: phraseText })
    : ({ ok: false, reason: "у ролика нет сценария (storyPlan)" } as const)
  if (!scriptPatch.ok) {
    warnings.push(
      `WARN новый текст не записан в сценарий (${scriptPatch.reason}) — `
      + "правка живёт только в треке, полная перегенерация вернёт прежнюю фразу",
    )
  }
  const scriptUpdate: ScriptPatchUpdate | null = scriptPatch.ok && scriptPatch.changed && script
    ? { variantId: script.variantId, storyPlan: scriptPatch.storyPlan }
    : null
  const scriptUpdated: ScriptTextTarget | null = scriptPatch.ok ? scriptPatch.target : null

  // Ключ вклейки. Отпечаток трека внутри обязателен: перегенерированный трек
  // приносит обратно ИСХОДНЫЙ текст сцены, и старая запись истории не должна
  // выдать её за уже сделанную.
  const spliceKey = createHash("sha1")
    .update([
      videoId,
      sceneOrder,
      phraseText,
      voiceId ?? "",
      modelId ?? "",
      video.voiceoverLanguage,
      video.voiceoverPacing,
      track.trackFingerprint,
    ].join(""))
    .digest("hex")

  const history = readSpliceHistory(voiceoverStep.snapshot)
  const alreadyDone = history.find(entry => entry.key === spliceKey && entry.trackPath === track.trackPath)
  if (alreadyDone) {
    // Работа уже сделана и оплачена. Не доехать могли две вещи, и обе бесплатны.
    //
    // Первая — сценарий: замену мог сделать прошлый код (или прогон, умерший
    // между транзакцией и ответом). Оставить сценарий со старой фразой значит
    // сохранить ровно ту дыру, ради которой всё и затевалось.
    if (scriptUpdate) {
      await store.commit([], scriptUpdate)
    }
    // Вторая — заливка склеенного трека в хранилище (она идёт после фиксации).
    if (!alreadyDone.uploaded && await media.fileExists(track.trackPath)) {
      await publishTrack(deps, {
        videoId,
        stepId: voiceoverStep.id,
        trackPath: track.trackPath,
        durationSec: track.durationSec,
        snapshot: (voiceoverStep.snapshot ?? {}) as Record<string, unknown>,
        entryKey: spliceKey,
      })
    }
    await store.appendLog(
      voiceoverStep.id,
      `Замена фразы сцены ${sceneOrder}: этот текст уже вклеен в трек — повторной оплаты нет`,
    )
    return {
      trackPath: track.trackPath,
      trackDurationSec: track.durationSec,
      trackFingerprint: track.trackFingerprint,
      deltaSec: alreadyDone.deltaSec,
      invalidatedSceneOrders: alreadyDone.invalidatedSceneOrders,
      costUsd: 0,
      reused: true,
      skippedPauses: alreadyDone.skippedPauses ?? [],
      sourceDurationMeasureFailed: alreadyDone.sourceDurationMeasureFailed ?? false,
      durationEstimated: alreadyDone.durationEstimated ?? false,
      scriptUpdated,
      warnings: [...(alreadyDone.warnings ?? []), ...warnings],
    }
  }

  const transcriptionStep = await store.readStep(videoId, "transcription")
  const scenes = readAlignedScenes(transcriptionStep?.snapshot)
  if (!transcriptionStep || scenes.length === 0) {
    throw new Error(
      `Замена фразы: у видео ${videoId} нет выравнивания — границы сцен в треке неизвестны, резать наугад нельзя`,
    )
  }
  const target = scenes.find(item => item.order === sceneOrder)
  if (!target) {
    throw new Error(`Замена фразы: сцены ${sceneOrder} нет в выравнивании трека — заменять нечего`)
  }

  const assetsDir = deps.assetsDir?.(videoId) ?? defaultAssetsDir(videoId)
  const phrasePath = join(assetsDir, `segment_${sceneOrder}_${spliceKey.slice(0, 12)}.mp3`)
  let costUsd = 0

  // Синтез одной фразы. Имя файла контент-адресное: файл на месте — значит эта
  // фраза этим голосом уже синтезирована и оплачена, в том числе прошлым
  // процессом, который умер посреди работы.
  if (!(await media.fileExists(phrasePath))) {
    const tts = await media.synthesize({
      videoId,
      text: phraseText,
      outputPath: phrasePath,
      modelId,
      voiceId,
      language: video.voiceoverLanguage,
      pacing: video.voiceoverPacing,
    })
    costUsd += tts.costUsd
    // Расход пишется ДО любой возможности броска ниже: отказ шага не должен
    // терять уже потраченные деньги.
    await store.recordCost({
      videoId,
      stepId: voiceoverStep.id,
      stepKey: "voiceover_generation",
      costUsd: tts.costUsd,
      modelId,
    })
  }

  let phraseAudioPath = phrasePath
  let phraseDurationSec = await media.probeDuration(phrasePath)
  let skippedPauses: TrackPause[] = []
  let sourceDurationMeasureFailed = false
  let durationEstimated = false

  if (request.pauses.length > 0) {
    const paused = await media.insertPauses(phrasePath, request.pauses, request.scenes, phraseDurationSec)
    phraseAudioPath = paused.path
    phraseDurationSec = paused.durationSec
    skippedPauses = [...paused.skippedPauses]
    sourceDurationMeasureFailed = paused.sourceDurationMeasureFailed
    durationEstimated = paused.durationEstimated
    if (skippedPauses.length > 0) {
      warnings.push(
        `WARN пауз не вставлено: ${skippedPauses.length} — для них не нашлось точки вставки`,
      )
    }
    if (sourceDurationMeasureFailed) {
      warnings.push("WARN длительность фразы до вставки пауз не измерена — тишина не вставлена вовсе")
    }
    if (durationEstimated) {
      warnings.push("WARN длительность фразы оценена, а не измерена — граница вклейки приблизительная")
    }
  }

  if (!(phraseDurationSec > 0)) {
    throw new Error(
      `Замена фразы: длительность синтезированной фразы ${phraseAudioPath} не измеряется — `
      + "вклеивать кусок неизвестной длины нельзя",
    )
  }

  // Длительность ИСХОДНОГО трека меряется заново (решение №5): в снапшоте она
  // могла быть оценкой, а от неё зависят и точка реза, и наличие хвоста.
  const sourceDurationSec = await media.probeDuration(track.trackPath)
  if (!(sourceDurationSec > 0)) {
    throw new Error(
      `Замена фразы: длительность трека ${track.trackPath} не измеряется — `
      + "трек эталон времени, гадать о нём нельзя",
    )
  }

  const silences = await media.detectSilence(track.trackPath)
  const plan = planSegmentSplice({
    sceneStartSec: target.startSec,
    sceneEndSec: target.endSec,
    trackDurationSec: sourceDurationSec,
    fps,
    silences,
  })
  if (!plan) {
    throw new Error(
      `Замена фразы: не нашли, куда вклеить фразу сцены ${sceneOrder} `
      + `(границы ${target.startSec.toFixed(2)}-${target.endSec.toFixed(2)}с при длине трека `
      + `${sourceDurationSec.toFixed(2)}с) — трек не тронут`,
    )
  }
  if (!plan.anchoredToSilence.start || !plan.anchoredToSilence.end) {
    warnings.push(
      "WARN рядом с границей сцены нет тишины — рез идёт по концу слова, стык склейки может быть слышен",
    )
  }

  // Склейка пишется в ОТДЕЛЬНЫЙ файл, а не поверх трека: источником для повтора
  // обязан остаться прежний трек, иначе оборванный прогон вклеил бы фразу
  // второй раз в уже склеенное. Имя детерминированное — повтор перезаписывает
  // свой же файл, а не плодит мусор.
  const splicedPath = join(assetsDir, `voiceover_track_${spliceKey.slice(0, 12)}.mp3`)
  const tempPath = buildTempSegmentPath(splicedPath)
  const filters = buildSpliceFilters(plan, phraseDurationSec, sourceDurationSec)
  let splicedDurationSec = 0

  try {
    await media.splice({
      trackPath: track.trackPath,
      phrasePath: phraseAudioPath,
      filters,
      outputPath: tempPath,
    })
    // Замер ДО переименования и именно у временного файла: под валидным именем
    // не должно оказаться недописанного трека.
    splicedDurationSec = await media.probeDuration(tempPath)
    if (!(splicedDurationSec > 0)) {
      throw new Error(
        `Замена фразы: длительность склеенного трека не измеряется (ffprobe вернул ${splicedDurationSec}) — `
        + "трек ролика оставляю прежним",
      )
    }
    await renameWithRetry(tempPath, splicedPath, 5, media.renameFile)
  } catch (err) {
    // Подчистка не должна маскировать исходную причину своей ошибкой.
    await media.removeFile(tempPath).catch(() => {})
    throw err
  }

  // Сверка измеренной склейки с моделью `acrossfade`: она выведена рассуждением
  // и живым ffmpeg не подтверждена (отчёт Task 2). Расхождение больше кадра
  // означает, что аналитическая ветка (предпросмотр «что пересоберётся» до
  // оплаты) врёт — и об этом обязан узнать оператор, а не только ролик.
  const seamCount = (plan.cutStartSec > 0 ? 1 : 0) + (plan.cutEndSec < sourceDurationSec ? 1 : 0)
  const analyticDeltaSec = phraseDurationSec
    - (plan.cutEndSec - plan.cutStartSec)
    - plan.crossfadeSec * seamCount
  const measuredDeltaSec = splicedDurationSec - sourceDurationSec
  if (Math.abs(measuredDeltaSec - analyticDeltaSec) > 1 / fps) {
    warnings.push(
      `WARN измеренная склейка разошлась с моделью кроссфейда: ffprobe даёт ${measuredDeltaSec.toFixed(3)}с, `
      + `арифметика ${analyticDeltaSec.toFixed(3)}с — расхождение больше кадра`,
    )
  }

  // Транскрибируется ТОЛЬКО новая фраза: до точки вклейки не изменился ни один
  // сэмпл, а после неё всё уехало на дельту. Результат кладётся рядом с файлом
  // фразы — повтор после рестарта поднимет его с диска и не заплатит второй раз.
  const alignmentCachePath = `${phraseAudioPath}.align.json`
  let replacementScene = await media.readJsonFile<AlignedScene>(alignmentCachePath)
  if (!replacementScene) {
    const transcribed = await media.transcribePhrase({
      videoId,
      stepId: transcriptionStep.id,
      audioPath: phraseAudioPath,
      text: phraseText,
      sceneOrder,
      language: video.voiceoverLanguage,
      outputPath: `${phraseAudioPath}.transcript.json`,
    })
    costUsd += transcribed.costUsd
    // Расход пишется ДО проверки результата: провайдер ответил и деньги списаны
    // даже тогда, когда границ из ответа не вышло.
    await store.recordCost({
      videoId,
      stepId: transcriptionStep.id,
      stepKey: "transcription",
      costUsd: transcribed.costUsd,
      modelId: null,
    })
    if (!transcribed.scene) {
      throw new Error(
        `Замена фразы: транскрипция новой фразы сцены ${sceneOrder} не дала границ слов — `
        + "без них вклеенный кусок остался бы без субтитров и без границ для lip-sync",
      )
    }
    // order фразы задаёт вызывающий, а не транскрипция: по нему сцена встаёт
    // на место выреза.
    replacementScene = { ...transcribed.scene, order: sceneOrder }
    await media.writeJsonFile(alignmentCachePath, replacementScene)
  }

  const shifted = shiftAlignmentAfterSplice({
    scenes,
    plan,
    replacementScene,
    replacementDurationSec: phraseDurationSec,
    trackDurationSec: sourceDurationSec,
    // Обязательно измеренная: без неё дельта считается аналитически и не
    // учитывает паддинг перекодировки.
    splicedTrackDurationSec: splicedDurationSec,
    fps,
  })

  // Инвалидация файлов идёт ДО фиксации снапшотов: снесённый файл при живой
  // записи безвреден (шаг проверяет существование и пересоберёт сцену), а
  // запись без файла после обрыва — нет.
  const moved = new Set(shifted.movedSceneOrders)
  const lipSyncStep = await store.readStep(videoId, "lip_sync_generation")
  const lipSyncSnapshot = (lipSyncStep?.snapshot ?? null) as { scenes?: Array<Record<string, unknown>> } | null
  const keptRecords: Array<Record<string, unknown>> = []
  if (lipSyncStep && lipSyncSnapshot) {
    for (const record of lipSyncSnapshot.scenes ?? []) {
      if (!moved.has(record.sceneOrder as number)) {
        keptRecords.push(record)
        continue
      }
      for (const path of recordFiles(record)) {
        await media.removeFile(path).catch(() => {})
      }
    }
  }

  const updatedScenes: AlignScene[] = track.scenes.map(item => (
    item.order === sceneOrder ? { ...item, text: phraseText } : item
  ))
  const entry: SpliceHistoryEntry = {
    key: spliceKey,
    sceneOrder,
    at: new Date().toISOString(),
    trackPath: splicedPath,
    deltaSec: shifted.deltaSec,
    invalidatedSceneOrders: shifted.movedSceneOrders,
    skippedPauses,
    sourceDurationMeasureFailed,
    durationEstimated,
    warnings,
    uploaded: false,
    fileSha256: null,
  }
  const voiceoverSnapshot: Record<string, unknown> = {
    ...(voiceoverStep.snapshot ?? {}),
    trackPath: splicedPath,
    durationSec: splicedDurationSec,
    // Отпечаток НЕ меняется — см. шапку модуля. Это не забывчивость, а решение:
    // sha склеенного файла обесценила бы куски всего ролика.
    trackFingerprint: track.trackFingerprint,
    scenes: updatedScenes,
    spliceHistory: [...history, entry],
  }
  const updates: StepSnapshotUpdate[] = [
    {
      stepId: transcriptionStep.id,
      snapshot: {
        ...(transcriptionStep.snapshot ?? {}),
        // Тот же отпечаток, что у озвучки: кэш шага транскрипции привязан к
        // нему, и разойдись они — следующий прогон оплатил бы разметку всего
        // трека заново ради границ, уже посчитанных арифметикой.
        trackFingerprint: track.trackFingerprint,
        scenes: shifted.scenes,
      },
    },
  ]
  if (lipSyncStep && lipSyncSnapshot) {
    updates.push({
      stepId: lipSyncStep.id,
      snapshot: { ...lipSyncSnapshot, scenes: keptRecords },
    })
  }
  // Снапшот озвучки — последним в списке: он несёт и новый трек, и запись
  // истории, то есть является точкой фиксации всей замены.
  updates.push({ stepId: voiceoverStep.id, snapshot: voiceoverSnapshot })
  // Сценарий уезжает ТОЙ ЖЕ транзакцией: разъехавшись, он оставил бы трек с
  // новой фразой при сценарии со старой — и следующая полная перегенерация
  // молча вернула бы прежний текст.
  await store.commit(updates, scriptUpdate)

  // Кадры сдвинувшихся сцен — обратно в planned. Замена к этому моменту уже
  // оплачена и зафиксирована, поэтому сбой здесь это предупреждение, а не
  // отказ: уронить всё после списания денег было бы худшим исходом.
  try {
    const affected = await store.resetShots(videoId, shifted.movedSceneOrders)
    if (affected > 0) {
      await store.appendLog(
        voiceoverStep.id,
        `Замена фразы сцены ${sceneOrder}: кадров переведено в planned — ${affected}`,
      )
    }
  } catch (err) {
    warnings.push(
      `WARN кадры сдвинувшихся сцен не переведены в planned (${err instanceof Error ? err.message : String(err)})`,
    )
  }

  await publishTrack(deps, {
    videoId,
    stepId: voiceoverStep.id,
    trackPath: splicedPath,
    durationSec: splicedDurationSec,
    snapshot: voiceoverSnapshot,
    entryKey: spliceKey,
  })

  await store.appendLog(
    voiceoverStep.id,
    `Замена фразы сцены ${sceneOrder}: трек ${splicedDurationSec.toFixed(2)}с `
    + `(дельта ${shifted.deltaSec >= 0 ? "+" : ""}${shifted.deltaSec.toFixed(3)}с), `
    + `на пересборку ${shifted.movedSceneOrders.length} сцен `
    + `(${shifted.movedSceneOrders.join(", ") || "—"}), стоимость $${costUsd.toFixed(3)}`
    + (warnings.length > 0 ? `; ${warnings.join("; ")}` : ""),
  )

  return {
    trackPath: splicedPath,
    trackDurationSec: splicedDurationSec,
    trackFingerprint: track.trackFingerprint,
    deltaSec: shifted.deltaSec,
    invalidatedSceneOrders: shifted.movedSceneOrders,
    costUsd,
    reused: false,
    skippedPauses,
    sourceDurationMeasureFailed,
    durationEstimated,
    scriptUpdated,
    warnings,
  }
}

/** Боевой каталог ассетов ролика — тот же, что у остальных шагов конвейера. */
function defaultAssetsDir(videoId: number): string {
  return getAssetsDirFor(videoId)
}

/**
 * Боевые порты: prisma, ffmpeg, TTS, транскрипция, хранилище.
 *
 * Тяжёлые модули подтягиваются ДИНАМИЧЕСКИМ импортом внутри методов, а не
 * статически сверху: статический импорт затащил бы половину конвейера (и
 * prisma) в любой чистый тест раннера, а этот файл обязан оставаться
 * пригодным для DB-free сьюты. ESM кэширует модуль, поэтому повторный
 * `import()` стоит ноль.
 */
export function createReplaceSegmentDeps(): ReplaceSegmentDeps {
  return {
    store: {
      loadVideo: async (videoId) => {
        const video = await prisma.video.findUnique({
          where: { id: videoId },
          select: {
            isLocked: true,
            voiceoverLanguage: true,
            voiceoverPacing: true,
            voiceoverVoiceId: true,
            voiceoverModelId: true,
          },
        })
        if (!video) return null
        return {
          isLocked: video.isLocked,
          voiceoverLanguage: video.voiceoverLanguage || "ru",
          voiceoverPacing: (video.voiceoverPacing as "slow" | "moderate" | "fast") || "moderate",
          voiceoverVoiceId: video.voiceoverVoiceId,
          voiceoverModelId: video.voiceoverModelId,
        }
      },

      readStep: async (videoId, stepKey) => {
        const step = await prisma.videoGenerationStep.findFirst({
          where: { videoId, stepKey: stepKey as never },
          select: { id: true, status: true, outputSnapshot: true },
        })
        if (!step) return null
        return {
          id: step.id,
          status: String(step.status),
          snapshot: (step.outputSnapshot ?? null) as Record<string, unknown> | null,
        }
      },

      // Сценарий ролика живёт в варианте (`ScenarioVariant.storyPlan`), а не в
      // самом ролике: именно оттуда `runAudioFirstVoiceover` собирает текст
      // трека. Варианта может не быть вовсе (legacy-ролик) — тогда и писать
      // некуда, и раннер это переживает предупреждением.
      loadScript: async (videoId) => {
        const video = await prisma.video.findUnique({
          where: { id: videoId },
          select: { variantId: true },
        })
        if (!video?.variantId) return null
        const variant = await prisma.scenarioVariant.findUnique({
          where: { id: video.variantId },
          select: { storyPlan: true },
        })
        if (!variant) return null
        return { variantId: video.variantId, storyPlan: variant.storyPlan }
      },

      // Одной транзакцией: разъехавшиеся снапшоты — это склеенный трек со
      // старым выравниванием, то есть субтитры и куски по звуку, которого в
      // треке уже нет. Сценарий здесь же: трек с новой фразой при сценарии со
      // старой — правка, которую первая же полная перегенерация отменит.
      commit: async (updates, script) => {
        const operations: unknown[] = updates.map(update => prisma.videoGenerationStep.update({
          where: { id: update.stepId },
          data: { outputSnapshot: update.snapshot as never },
        }))
        if (script) {
          operations.push(prisma.scenarioVariant.update({
            where: { id: script.variantId },
            data: { storyPlan: script.storyPlan as never },
          }))
        }
        if (operations.length === 0) return
        await prisma.$transaction(operations as never)
      },

      appendLog: async (stepId, message) => {
        const { appendStepLog } = await import("../video-pipeline-db")
        await appendStepLog(stepId, message)
      },

      recordCost: async ({ costUsd, modelId, stepId, stepKey, videoId }) => {
        if (!(costUsd > 0)) return
        const { logStepCost } = await import("../balance/cost-ledger")
        const { mapStepKeyToService } = await import("../balance/cost-attribution")
        const { accumulateStepCost, stepAttemptForLedger } = await import("../video-cost-actual")
        const step = await prisma.videoGenerationStep.findUnique({
          where: { id: stepId },
          select: { actualCost: true, attemptCount: true },
        })
        // Замена — это НОВОЕ списание у провайдера, а дедуп ledger'а завязан на
        // номер попытки: запиши мы её прежним номером, расход молча пропал бы
        // как дубль первой синтезации.
        const attempt = stepAttemptForLedger((step?.attemptCount ?? 0) + 1)
        await prisma.videoGenerationStep.update({
          where: { id: stepId },
          data: {
            actualCost: accumulateStepCost(step?.actualCost ?? 0, costUsd),
            attemptCount: attempt,
          },
        })
        await logStepCost(
          stepId,
          stepKey,
          mapStepKeyToService(stepKey as never, modelId),
          costUsd,
          videoId,
          modelId,
          { attempt },
        )
      },

      resetShots: async (videoId, sceneOrders) => {
        if (sceneOrders.length === 0) return 0
        const result = await prisma.videoShot.updateMany({
          where: { videoId, sceneOrder: { in: [...sceneOrders] } },
          // Только статус: план кадра (`background`, `idea`, границы) решает
          // шаг edit_plan, и переписывать его отсюда нельзя.
          data: { status: "planned" },
        })
        return result.count
      },

      saveTrackAsset: async ({ durationSec, storage, trackPath, videoId }) => {
        const { storageKeyToLegacyUrl } = await import("../storage/download-to-storage")
        const storageKey = storage.storageKey as string | undefined
        const data = {
          filePath: trackPath,
          fileUrl: storageKey ? storageKeyToLegacyUrl(storageKey) : undefined,
          duration: Math.round(durationSec),
          ...storage,
        }
        const existing = await prisma.videoAsset.findFirst({
          where: { videoId, type: "voiceover_mix" as never },
        })
        if (existing) {
          await prisma.videoAsset.update({ where: { id: existing.id }, data: data as never })
          return
        }
        await prisma.videoAsset.create({
          data: { videoId, type: "voiceover_mix" as never, order: 98, ...data } as never,
        })
      },
    },

    media: {
      fileExists: async (path) => {
        const { access } = await import("node:fs/promises")
        try {
          await access(path)
          return true
        } catch {
          return false
        }
      },

      removeFile: async (path) => {
        const { unlink } = await import("node:fs/promises")
        // Файла может не быть вовсе (снесён прошлым заходом) — это не ошибка.
        await unlink(path).catch(() => {})
      },

      renameFile: async (from, to) => {
        const { rename } = await import("node:fs/promises")
        await rename(from, to)
      },

      readJsonFile: async <T>(path: string): Promise<T | null> => {
        const { readFile } = await import("node:fs/promises")
        try {
          return JSON.parse(await readFile(path, "utf-8")) as T
        } catch {
          // Нет файла или он битый — считаем, что кэша нет. Платный вызов
          // повторится, но соврать разобранным наполовину JSON хуже.
          return null
        }
      },

      writeJsonFile: async (path, value) => {
        const { writeFile } = await import("node:fs/promises")
        await writeFile(path, JSON.stringify(value), "utf-8")
      },

      probeDuration: async (path) => {
        const { probeAudioDuration } = await import("../tts")
        return probeAudioDuration(path)
      },

      detectSilence: async (path) => {
        const { detectSilenceRanges } = await import("../video-tools/silence-detect")
        return detectSilenceRanges(path)
      },

      synthesize: async (input) => {
        const { synthesizeSpeech } = await import("../tts")
        const result = await synthesizeSpeech({
          text: input.text,
          outputPath: input.outputPath,
          modelId: input.modelId,
          voiceId: input.voiceId,
          language: input.language,
          pacing: input.pacing,
          videoId: input.videoId,
        })
        return {
          audioPath: result.audioPath,
          durationSec: result.durationSec,
          costUsd: result.costUsd,
        }
      },

      insertPauses: async (path, pauses, scenes, synthDurationSec) => {
        const { insertVoiceoverPauses } = await import("./insert-pauses")
        return insertVoiceoverPauses(path, pauses, scenes, synthDurationSec)
      },

      splice: async ({ filters, outputPath, phrasePath, trackPath }) => {
        const ffmpeg = (await import("fluent-ffmpeg")).default
        await new Promise<void>((resolve, reject) => {
          const stderrTail: string[] = []
          ffmpeg()
            // Порядок входов важен: граф из `buildSpliceFilters` берёт трек как
            // [0:a], а пересинтезированную фразу как [1:a].
            .input(trackPath)
            .input(phrasePath)
            .complexFilter(filters, ["aout"])
            .outputOptions(["-c:a", "libmp3lame", "-b:a", "192k", "-y"])
            .output(outputPath)
            .on("stderr", (line: string) => {
              stderrTail.push(line)
              if (stderrTail.length > 20) stderrTail.shift()
            })
            .on("end", () => resolve())
            .on("error", (err: Error) => {
              const tail = stderrTail.slice(-10).join("\n")
              reject(new Error(
                `Не удалось вклеить фразу в трек ${trackPath}: ${err.message}`
                + (tail ? `\n--- stderr ---\n${tail}` : ""),
              ))
            })
            .run()
        })
      },

      transcribePhrase: async ({ audioPath, language, outputPath, sceneOrder, stepId, text, videoId }) => {
        const { requestTranscription } = await import("../transcription/media-task")
        const scenes: AlignScene[] = [{ order: sceneOrder, text }]
        const task = await requestTranscription({
          videoId,
          stepId,
          audioPath,
          language,
          outputPath,
          scenes,
        })
        try {
          const { normalizeTranscriptPayload } = await import("../transcription/normalize")
          const { alignScriptToTranscript } = await import("../transcription/align")
          const alignment = alignScriptToTranscript({
            scenes,
            transcript: normalizeTranscriptPayload(task.raw),
          })
          return { scene: alignment.scenes[0] ?? null, costUsd: task.costUsd }
        } catch {
          // Провайдер ответил и деньги списаны — стоимость обязана уйти наверх
          // даже тогда, когда ответ не разобран. Решение «падать ли» принимает
          // раннер, уже записав расход.
          return { scene: null, costUsd: task.costUsd }
        }
      },

      uploadTrack: async ({ path, videoId }) => {
        const { uploadLocalAsset } = await import("../storage/persist-asset")
        const { StorageKeys } = await import("../storage/keys")
        // Тот же ключ, что у шага озвучки: `restoreTrackFile` тянет трек по
        // нему, и залей мы склейку в другое место — рестарт вернул бы на диск
        // СТАРЫЙ звук под новым именем.
        const columns = await uploadLocalAsset(path, StorageKeys.videoVoiceoverMix(videoId), "audio/mpeg")
        return {
          storageKey: columns.storageKey ?? null,
          fileSha256: columns.fileSha256 ?? null,
          columns: columns as unknown as Record<string, unknown>,
        }
      },
    },
  }
}

/**
 * Статусы, в которых замену фразы вообще имеет смысл начинать.
 *
 * Тот же список, что у перегенерации одного кадра
 * (`shots/[order]/rerender.post.ts`): ролик либо досмотрен, либо остановился.
 * Ролик в середине генерации трогать нельзя даже без блокировки — прогон
 * перезапишет снапшоты шагов своими значениями.
 *
 * `awaiting_operator` (пошаговый режим, §9) сюда входит осознанно: это тоже
 * ОСТАНОВЛЕННЫЙ ролик — шаг доведён до конца, блокировка отпущена, процесса
 * нет (`video-pipeline-stepwise.ts`). Отказ заставил бы оператора сначала
 * нажать «принять», то есть оплатить следующие шаги, только ради того, чтобы
 * поправить одну фразу. Что при этом НЕЛЬЗЯ — так это продолжать прогон за
 * него; см. `resumePipeline` ниже.
 */
export const REPLACEABLE_VIDEO_STATUSES = [
  "completed",
  "failed",
  "canceled",
  AWAITING_OPERATOR_STATUS,
] as const

export type ReplaceSegmentRequestPlan =
  | {
    ok: true
    videoId: number
    sceneOrder: number
    newText: string
    /**
     * Запускать ли пересборку сразу после замены.
     *
     * Для ролика в ожидании — `false`: продолжение это решение оператора и
     * только его. Переведи ручка такой ролик в `pending` и запусти прогон,
     * правка одной фразы молча сняла бы пошаговый режим, потеряла бы
     * `awaitingStepKey` и оплатила бы шаги, которых никто не принимал.
     */
    resumePipeline: boolean
    /** В каком статусе ролик останется после замены. */
    nextStatus: "pending" | typeof AWAITING_OPERATOR_STATUS
  }
  | { ok: false, statusCode: number, message: string }

/**
 * Разбор и гейты запроса на замену — чистой функцией, без Nitro и БД.
 *
 * Обработчик остаётся тонким (AGENTS.md), а правила «какой ролик можно
 * править» проверяются тестом, а не глазами: разойдись они с реальностью,
 * оператор либо получил бы отказ на живом ролике, либо влез бы в идущий прогон.
 */
export function planReplaceSegmentRequest(input: {
  id: number
  body: { sceneOrder?: unknown, newText?: unknown } | null | undefined
  video: { status: string, isLocked: boolean } | null
}): ReplaceSegmentRequestPlan {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    return { ok: false, statusCode: 400, message: "Некорректный ID видео" }
  }

  const sceneOrder = Number(input.body?.sceneOrder)
  if (!Number.isInteger(sceneOrder) || sceneOrder <= 0) {
    return { ok: false, statusCode: 400, message: "Поле 'sceneOrder' обязательно и должно быть целым номером сцены" }
  }

  const newText = typeof input.body?.newText === "string" ? input.body.newText.trim() : ""
  if (!newText) {
    return { ok: false, statusCode: 400, message: "Поле 'newText' обязательно и не может быть пустым" }
  }

  if (!input.video) {
    return { ok: false, statusCode: 404, message: "Видео не найдено" }
  }
  if (input.video.isLocked) {
    return { ok: false, statusCode: 409, message: "Видео заблокировано — идёт другая операция" }
  }
  if (!REPLACEABLE_VIDEO_STATUSES.includes(input.video.status as typeof REPLACEABLE_VIDEO_STATUSES[number])) {
    return {
      ok: false,
      statusCode: 400,
      message: `Замена фразы недоступна в статусе '${input.video.status}'`,
    }
  }

  const awaiting = input.video.status === AWAITING_OPERATOR_STATUS
  return {
    ok: true,
    videoId: input.id,
    sceneOrder,
    newText,
    resumePipeline: !awaiting,
    nextStatus: awaiting ? AWAITING_OPERATOR_STATUS : "pending",
  }
}
