/**
 * Lip-Sync Runner — премиум-шаг между clip_generation и assembly.
 *
 * Для каждой сцены, у которой в storyPlan есть spokenLine и в кадре person-протагонист,
 * runner синтезирует TTS, отдаёт исходный клип + аудио в lip-sync провайдер и
 * подставляет результат на место этой сцены. Дальнейший пайплайн получает
 * lip-synced версию и собирает финальное видео.
 *
 * Гейт: video.lipSyncEnabled === true. Пресет quality включает по умолчанию,
 * budget/balanced — нет.
 *
 * Сцена и клип сопоставляются по ФАКТИЧЕСКОМУ порядку нарезки клипов (см.
 * ./presenter/clip-scene-orders и ./presenter/scene-clip-mapping): scene.order из
 * storyPlan 1-based, order у VideoAsset(type=clip) — 0-based индекс цикла генерации,
 * а сам цикл идёт по prompts.scenePrompts.scenes, порядок которых задаёт Claude.
 * Позиционного фолбэка по videoPlan.scenes здесь НЕТ: при перестановке сцен он
 * отдаёт реплику на чужой клип, причём за деньги. Порядок неизвестен — сцена
 * пропускается с логом.
 *
 * Прогресс шага персистится ПОСЛЕ КАЖДОЙ сцены: обрыв в середине (упавшая заливка,
 * перезапуск воркера) раньше оставлял outputSnapshot пустым, и повторный заход
 * заново оплачивал TTS и Replicate по уже готовым сценам.
 *
 * Маршрут «монтаж от звука» (input.audioFirst): речь ролика синтезирована ОДНИМ
 * треком заранее, и звук сцены не синтезируется, а вырезается из этого трека по
 * границам выравнивания (./voiceover/segment-cut). Посценный синтез на таком
 * ролике вреден: у TTS нет seed, вторая запись звучит иначе той, что уже лежит
 * под таймлайном, — губы разъезжаются со звуком, и синтез оплачивается дважды.
 * Параметра нет — работает прежний посценный маршрут, ни одна старая сцена о
 * новом ничего не знает.
 */

import { basename, extname, join } from "node:path"
import { access, mkdir, stat, unlink } from "node:fs/promises"
import { createHash } from "node:crypto"
import { prisma } from "./prisma"
import { ensureStep, updateStep, appendStepLog, isStepCompleted, type StepKey } from "./video-pipeline-db"
import { updateVideoStatus } from "./video-pipeline-db"
import { synthesizeSpeech } from "./tts"
import { runLipSync } from "./media-provider/lip-sync"
import { resolveMediaModel } from "./media-provider/registry"
import { getModel, getDefaultLipSyncModel } from "./video-models"
import { getAssetsDirFor } from "./storage-paths"
import { StorageKeys } from "./storage/keys"
import { uploadLocalAsset } from "./storage/persist-asset"
import { storageKeyToLegacyUrl } from "./storage/download-to-storage"
import { getStorageDriver } from "./storage"
import { downloadFile } from "./video-helpers"
import { adjustAudioTempo, probeMediaDuration } from "./render"
import { reservePresenterSourceClip } from "./presenter-source-selector"
import {
  characterHasAvatarPortrait,
  findSimilarAvatarClip,
  generateAvatarSourceClip,
  planPresenterSourceStrategy,
  presenterRoutePrefersAvatar,
  type AvatarClipFrameRecord,
} from "./avatar-source"
import { logStepCost } from "./balance/cost-ledger"
import { accumulateStepCost } from "./video-cost-actual"
import {
  buildLipSyncReuseKey,
  buildSceneClipIndexMap,
  presenterTargetDuration,
  clampDurationToModelRange,
  findEmptyClipPathIndexes,
  hasClipPath,
  hashSpeechIdentity,
  hashSpokenLine,
  isAssignableClipIndex,
  isDurationWithinModelRange,
  isSourceDurationCloseToScene,
  planSpeechFitToModel,
  resolveSceneSourcePath,
  MAX_SPEECH_SPEEDUP,
  MODEL_DURATION_TOLERANCE_SEC,
} from "./presenter/scene-clip-mapping"
import { loadClipSceneOrders } from "./presenter/clip-scene-orders"
import {
  cutTrackSegment,
  planSegmentCut,
  segmentIdentity,
  snapSecToFrame,
  type SegmentCut,
} from "./voiceover/segment-cut"
import type { AlignedScene } from "./transcription/align"
import {
  areAllScenesCovered,
  areAllScenesReusable,
  mergeSceneRecords,
  readPreviousSceneRecords,
  type LipSyncSceneRecord,
  type LipSyncSkipReason,
} from "./presenter/lip-sync-progress"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const STEP_KEY: StepKey = "lip_sync_generation"
const STEP_ORDER_INDEX = 5
/** Фолбэк-границы длительности источника, если модели нет в media-provider реестре. */
const FALLBACK_MIN_DURATION_SEC = 2
const FALLBACK_MAX_DURATION_SEC = 10
/** Частота кадров сборки: к её сетке притягиваются границы куска трека. */
const DEFAULT_TIMELINE_FPS = 30

export type { LipSyncSceneRecord, LipSyncSkipReason }

export interface LipSyncStepResult {
  /** 'disabled' — фича выключена; 'skipped' — нет сцен с spokenLine; 'completed' — успех */
  status: "disabled" | "skipped" | "completed"
  /** Обновлённые пути клипов (lip-synced где применимо, оригиналы где нет) */
  clipPaths: string[]
  /** Сколько сцен синхронизировано ВСЕГО (свежие + переиспользованные из снапшота) */
  syncedSceneCount: number
  /**
   * Сколько сцен реально ушло в lip-sync провайдер в ЭТОМ прогоне — то есть у скольких
   * сцен на диске появились НОВЫЕ файлы.
   *
   * Оркестратор решает по этому числу, можно ли доверять путям клипов из кэша озвучки:
   * раньше он смотрел на прирост attemptCount, а тот растёт и когда шаг всё
   * переиспользовал (снапшот неполон — ранняя ветка идемпотентности не сработала).
   * Прогон, где всё поднято из снапшота, файлов не менял, и удлинённые озвучкой
   * клипы прошлого прогона остаются валидными.
   *
   * Поле необязательное ради снапшотов прошлых версий: там его нет, и трактовать
   * отсутствие как 0 нельзя. Сам runLipSyncStep возвращает его всегда.
   */
  resyncedSceneCount?: number
  /** Суммарная стоимость lip-sync (USD) */
  totalCostUsd: number
  /** ID lip-sync модели */
  modelId: string | null
  /** Пофайловый результат по сценам (для повторного захода без повторной оплаты) */
  scenes?: LipSyncSceneRecord[]
}

/**
 * Готовый общий трек ролика и границы сцен в нём — вход маршрута «монтаж от звука».
 *
 * Передаёт оркестратор и только у ролика с `editPipeline === true`: у остальных
 * единого трека не существует. Здесь параметр намеренно необязательный — шаг не
 * ходит за ним в БД сам, чтобы прежний маршрут не зависел от новых данных.
 */
export interface LipSyncAudioFirstInput {
  /** Файл единого трека — эталон времени для всей сборки. */
  trackPath: string
  /** Длительность трека, измеренная шагом озвучки: за неё кусок не вылезает. */
  trackDurationSec: number
  /**
   * Отпечаток трека. Перезаписанный трек обязан обесценить все вырезанные куски
   * и готовые lip-sync сцены: текст реплики при этом мог не измениться ни на
   * букву, а губы под новым звуком были бы старыми.
   */
  trackFingerprint: string
  /** Сцены с границами из выравнивания (./transcription/align). */
  scenes: readonly AlignedScene[]
  /** Частота кадров сборки; не передана — 30 кадров. */
  fps?: number
}

export interface LipSyncStepInput {
  videoId: number
  clipPaths: string[]
  videoPlan: StoryDrivenVideoPlan | null
  /**
   * Маршрут «монтаж от звука»: звук сцены вырезается из общего трека вместо
   * посценного синтеза. Не передан — прежний посценный маршрут без изменений.
   */
  audioFirst?: LipSyncAudioFirstInput | null
  /**
   * order'ы сцен в порядке нарезки клипов (prompts.scenePrompts.scenes).
   * Не передан — читаем из снапшота prompt_generation; если и его нет, порядок
   * считается неизвестным и сцены пропускаются (см. шапку модуля).
   */
  clipSceneOrders?: readonly number[] | null
  videoConfig: {
    lipSyncEnabled: boolean
    lipSyncModelId: string | null
    lipSyncCharacterId: string | null
    voiceoverModelId: string | null
    voiceoverVoiceId: string | null
    voiceoverLanguage: string
    voiceoverPacing: "slow" | "moderate" | "fast"
    /** Нужен аватарной ветке: кадр оживления снимается в формате ролика. */
    format?: "portrait" | "landscape"
  }
}

export async function runLipSyncStep(input: LipSyncStepInput): Promise<LipSyncStepResult> {
  const { videoId, clipPaths, videoPlan, videoConfig } = input
  const step = await ensureStep(videoId, STEP_KEY, STEP_ORDER_INDEX)

  // Gate 1: feature off
  if (!videoConfig.lipSyncEnabled) {
    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
      outputSnapshot: { reason: "lip_sync_disabled_by_config" },
    })
    await appendStepLog(step.id, "Lip-sync отключён в конфиге (lipSyncEnabled=false)")
    return { status: "disabled", clipPaths, syncedSceneCount: 0, resyncedSceneCount: 0, totalCostUsd: 0, modelId: null }
  }

  // Gate 2: нет storyPlan/scenes с spokenLine
  const isStoryDriven = videoPlan && videoPlan.mode !== "legacy_simple"
  const sceneUnits = isStoryDriven ? videoPlan.scenes : []
  const lipSyncTargets = sceneUnits.filter(s => s.spokenLine && s.spokenLine.trim().length > 0)

  if (lipSyncTargets.length === 0) {
    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
      outputSnapshot: { reason: isStoryDriven ? "no_spoken_lines" : "legacy_mode_no_lip_sync" },
    })
    await appendStepLog(step.id, isStoryDriven
      ? "В storyPlan нет ни одной сцены с spokenLine — нечего синхронизировать"
      : "Legacy mode (без StoryPlan) — lip-sync недоступен")
    return { status: "skipped", clipPaths, syncedSceneCount: 0, resyncedSceneCount: 0, totalCostUsd: 0, modelId: null }
  }

  // Клип сцены ищем ТОЛЬКО по фактическому порядку нарезки: порядок scenePrompts
  // задаёт Claude и он не обязан совпадать с videoPlan.scenes. Позиционного фолбэка
  // здесь нет намеренно — при перестановке сцен он отдал бы реплику на чужой клип,
  // причём за деньги. Порядок неизвестен — сцены пропускаются с логом.
  const clipSceneOrders = input.clipSceneOrders ?? await loadClipSceneOrders(videoId)
  const sceneIndexByOrder = buildSceneClipIndexMap(sceneUnits, clipSceneOrders, {
    allowPositionalFallback: false,
  })

  /**
   * Есть ли у ролика маршрут ведущей: сцену без сгенерированного клипа снимает
   * фрагмент из библиотеки персонажа (или, если библиотека пуста, его портрет).
   *
   * Именно по этому признаку сцена с ПУСТОЙ ячейкой в clipPaths не считается
   * потерянной: с 15.08.2026 список клипов идёт по сценам, и пустая ячейка —
   * не «клип не нашёлся», а «клип этой сцены делает как раз этот шаг».
   */
  const presenterRouteAvailable = !!videoConfig.lipSyncCharacterId

  /**
   * Ролик, снятый целиком живой ведущей.
   *
   * Такому ролику text-to-video не запускали ни разу (см. presenterSceneIndexes в
   * runClipGeneration): своего клипа нет НИ У ОДНОЙ сцены, снапшота
   * prompt_generation нет, и сопоставлять сцену не с чем. Позиция сцены в плане
   * здесь не догадка, а единственный возможный порядок — чужих клипов, на которые
   * могла бы уехать реплика, просто не существует. Клип каждой сцены создаёт этот шаг.
   *
   * Проверяем именно заполненность ячеек, а не длину массива: шаг клипов теперь
   * отдаёт ячейку на каждую сцену, и у ролика ведущей все они пусты.
   */
  const presenterOnlyVideo = presenterRouteAvailable
    && !clipPaths.some(hasClipPath)
    && sceneUnits.length > 0
    && lipSyncTargets.length === sceneUnits.length

  /** Индекс сцены на таймлайне: порядок нарезки, а у ролика ведущей — позиция в плане. */
  const sceneIndexOf = (scene: (typeof sceneUnits)[number]): number | undefined => {
    const mapped = sceneIndexByOrder.get(scene.order)
    if (mapped !== undefined) return mapped
    return presenterOnlyVideo ? sceneUnits.indexOf(scene) : undefined
  }

  /**
   * Путь-якорь для отпечатка сцены. У ролика ведущей исходного клипа нет вовсе,
   * а исходник ведущей резервируется заново на каждом прогоне — его путь в ключ
   * брать нельзя, иначе кэш не сработает никогда. Якорь стабильный и синтетический.
   */
  const sourceAnchorFor = (sceneIndex: number, resolvedPath: string | null): string =>
    resolvedPath ?? `presenter:${videoConfig.lipSyncCharacterId ?? ""}:scene:${sceneIndex}`

  // Снапшот читаем НЕЗАВИСИМО от статуса шага: прерванный прогон оставляет
  // частичный снапшот именно в статусе running/failed, и это его единственный смысл.
  const previousByIndex = readPreviousSceneRecords(step.outputSnapshot)
  // undefined остаются намеренно: areAllScenesCovered обязан отличать «сцене не нашлось
  // клипа в порядке нарезки» (записи быть не может) от «сцена ещё не обработана».
  const targetIndexes = lipSyncTargets.map(scene => sceneIndexOf(scene))

  /**
   * Маршрут «монтаж от звука»: границы сцен в общем треке. Пусто — ни одна ветка
   * ниже про трек даже не спросит, и шаг работает ровно как раньше.
   */
  const audioFirst = input.audioFirst ?? null
  const timelineFps = audioFirst?.fps ?? DEFAULT_TIMELINE_FPS
  const alignedSceneByOrder = new Map<number, AlignedScene>()
  const duplicateAlignedOrders: number[] = []
  for (const aligned of audioFirst?.scenes ?? []) {
    // order из плана AI умеет повторяться (см. аватарную ветку ниже), и молча
    // схлопнутый дубль отдал бы двум сценам один и тот же кусок трека.
    if (alignedSceneByOrder.has(aligned.order)) duplicateAlignedOrders.push(aligned.order)
    alignedSceneByOrder.set(aligned.order, aligned)
  }
  if (duplicateAlignedOrders.length > 0) {
    await appendStepLog(
      step.id,
      `WARN в выравнивании повторяются order сцен: ${duplicateAlignedOrders.join(", ")} — `
      + `беру последние границы, но сцены с одинаковым order получат один кусок трека`,
    )
  }

  /**
   * Отпечаток куска трека для КЛЮЧА СЦЕНЫ — по границам выравнивания, притянутым
   * к кадру, но БЕЗ зажатия в диапазон модели: модель уже учтена в ключе своим id,
   * а границы нужны здесь, в ранней ветке идемпотентности, где модель ещё не
   * разрешена.
   *
   * Притяжка к кадру обязательна: без неё дрожание выравнивания в единицы
   * миллисекунд при том же треке меняло бы ключ, хотя кусок вырезается тот же
   * байт в байт — ролик из двух десятков сцен переоплачивал бы lip-sync на пустом
   * месте. fps ролика — константа сборки, и здесь она известна.
   *
   * Имя файла куска считается отдельно и от ЗАЖАТЫХ границ (см. цикл): там
   * важна фактическая длина вырезанного звука.
   */
  const trackSegmentKeyFor = (sceneOrder: number): string | null => {
    if (!audioFirst) return null
    const aligned = alignedSceneByOrder.get(sceneOrder)
    if (!aligned) return null
    return segmentIdentity({
      videoId,
      sceneOrder,
      startSec: snapSecToFrame(aligned.startSec, timelineFps),
      endSec: snapSecToFrame(aligned.endSec, timelineFps),
      trackFingerprint: audioFirst.trackFingerprint,
    })
  }

  /**
   * Отпечаток сцены: по нему решаем, годится ли уже готовый lip-sync файл.
   * Кроме текста в него входят исходник (путь + размер/mtime), персонаж и параметры
   * синтеза — смена любого из них делает старый результат устаревшим.
   *
   * На маршруте «монтаж от звука» к этому добавляется отпечаток куска трека:
   * текста мало, потому что перезаписанный трек звучит иначе при том же тексте, и
   * старый lip-sync оказался бы старыми губами под новым звуком.
   */
  const reuseKeyFor = async (
    spokenLine: string,
    sourcePath: string,
    trackSegmentKey: string | null,
  ): Promise<string> => {
    const base = await buildLipSyncReuseKey({
      spokenLine,
      sourcePath,
      sourceSignature: await readFileSignature(sourcePath),
      lipSyncCharacterId: videoConfig.lipSyncCharacterId,
      // Именно запрошенная в конфиге модель: резолв модели идёт ниже, а ключ
      // нужен уже здесь, в ранней ветке идемпотентности.
      lipSyncModelId: videoConfig.lipSyncModelId,
      voiceoverModelId: videoConfig.voiceoverModelId,
      voiceoverVoiceId: videoConfig.voiceoverVoiceId,
      voiceoverLanguage: videoConfig.voiceoverLanguage,
      voiceoverPacing: videoConfig.voiceoverPacing,
    })
    // Прежний маршрут получает ровно прежний ключ — старые снапшоты обязаны
    // читаться как раньше, иначе первый же прогон переоплатит готовые сцены.
    if (!trackSegmentKey) return base
    return createHash("sha1").update(`${base} ${trackSegmentKey}`).digest("hex")
  }

  // Idempotency: шаг завершён, в снапшоте есть КАЖДАЯ сцена с репликой И отпечатки
  // сцен совпадают с текущими. Без второго условия completed-шаг с половиной сцен
  // навсегда оставался бы недоделанным; без третьего смена персонажа/голоса или
  // перегенерация клипов возвращала бы кэш поверх устаревших исходников.
  if (isStepCompleted(step) && step.outputSnapshot) {
    const cached = step.outputSnapshot as unknown as LipSyncStepResult
    const expectedKeys = new Map<number, string>()
    for (const scene of lipSyncTargets) {
      const sceneIndex = sceneIndexOf(scene)
      if (sceneIndex === undefined) continue
      // Источник тот же, что возьмёт цикл: clipPaths шага clip_generation, иначе
      // сохранённый в снапшоте исходник. У ролика ведущей исходника нет — идём
      // на синтетический якорь, ровно как в самом цикле.
      const resolvedPath = resolveSceneSourcePath({
        sceneIndex,
        clipPaths,
        snapshotSourcePath: previousByIndex.get(sceneIndex)?.sourcePath,
      }).path
      if (!resolvedPath && !presenterRouteAvailable) continue
      expectedKeys.set(sceneIndex, await reuseKeyFor(
        scene.spokenLine!.trim(),
        sourceAnchorFor(sceneIndex, resolvedPath),
        trackSegmentKeyFor(scene.order),
      ))
    }
    const covered = areAllScenesCovered(targetIndexes, previousByIndex)
      && areAllScenesReusable(expectedKeys, previousByIndex)
    // Длину сверяем с входным массивом только там, где он вообще был: у ролика
    // ведущей клипы создаёт этот шаг, и списки заведомо разной длины (0 против N).
    const lengthMatches = presenterOnlyVideo
      ? cached.clipPaths?.length === lipSyncTargets.length
      : cached.clipPaths?.length === clipPaths.length
    if (covered && Array.isArray(cached.clipPaths) && lengthMatches) {
      // resyncedSceneCount берём НЕ из снапшота: там лежит число того прогона, который
      // реально платил. Здесь мы файлов не трогали — оркестратору важно именно это,
      // иначе он выбросит удлинённые озвучкой клипы как «относящиеся к прошлым».
      return { ...cached, resyncedSceneCount: 0 }
    }
  }

  // Resolve lip-sync model
  const preferredId = videoConfig.lipSyncModelId
  const preferredModel = preferredId ? getModel(preferredId) : null
  const model = preferredModel?.integrated
    && preferredModel.provider.toLowerCase().includes("replicate")
    ? preferredModel
    : getDefaultLipSyncModel()
  if (!model || model.task !== "lip_sync") {
    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
      outputSnapshot: { reason: "no_integrated_lip_sync_model" },
    })
    await appendStepLog(step.id, "Lip-sync включён, но не найдена интегрированная модель — пропускаю")
    return { status: "skipped", clipPaths, syncedSceneCount: 0, resyncedSceneCount: 0, totalCostUsd: 0, modelId: null }
  }

  const { minDurationSec, maxDurationSec } = resolveModelDurationRange(model.id)

  /**
   * План куска трека под сцену: границы (кадр → длина трека → диапазон модели) и
   * его отпечаток. Отпечаток уходит в имя файла, поэтому считается уже по ЗАЖАТЫМ
   * границам: смена lip-sync модели меняет их, и кусок старой длины не подставится
   * под новую модель.
   */
  const planTrackSegment = (
    aligned: AlignedScene,
    track: LipSyncAudioFirstInput,
  ): { cut: SegmentCut, identity: string } => {
    const cut = planSegmentCut({
      scene: aligned,
      trackDurationSec: track.trackDurationSec,
      fps: timelineFps,
      model: { minDurationSec, maxDurationSec },
    })
    return {
      cut,
      identity: segmentIdentity({
        videoId,
        sceneOrder: aligned.order,
        startSec: cut.startSec,
        endSec: cut.endSec,
        trackFingerprint: track.trackFingerprint,
      }),
    }
  }

  // Номер попытки нужен ledger'у: rerun шага — это реальное повторное списание
  // у провайдера, и оно обязано быть отдельной строкой расхода (см. cost-ledger).
  const attempt = step.attemptCount + 1

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: attempt,
  })
  await updateVideoStatus(videoId, "assembling", { currentStep: STEP_KEY })
  await appendStepLog(step.id, `Lip-sync: ${lipSyncTargets.length} сцен, модель ${model.id}, попытка ${attempt}`)
  if (sceneIndexByOrder.size === 0) {
    // Снапшот prompt_generation отсутствует или дырявый (старое видео, сброшенный
    // шаг). Раньше здесь включался позиционный фолбэк и сцены могли уехать на чужие
    // клипы; теперь шаг честно ничего не делает.
    await appendStepLog(
      step.id,
      "Порядок нарезки клипов неизвестен (нет снапшота prompt_generation) — сопоставить сцены с клипами нельзя, синхронизация пропущена",
    )
  }

  // У ролика ведущей входной массив пуст, а мест на таймлайне столько же, сколько
  // сцен: резервируем их сразу, иначе присваивание по индексу расширяло бы массив
  // дырами. Незаполненные места ловятся ниже как незакрытые сцены.
  const updatedClipPaths = presenterOnlyVideo
    ? new Array<string>(sceneUnits.length).fill("")
    : [...clipPaths]
  // Стоимость шага ДО этого прогона: actualCost — деньги, потраченные на шаг по
  // этому ролику, а не за последний заход (см. accumulateStepCost).
  const costBefore = step.actualCost
  let syncedSceneCount = 0
  let reusedSceneCount = 0
  // Сцены, которые в ЭТОМ прогоне реально ушли в провайдер и дали новые файлы.
  // Именно по этому числу оркестратор решает, устарели ли пути клипов из кэша озвучки.
  let resyncedSceneCount = 0
  let totalCostUsd = 0
  const costByService = new Map<"replicate" | "fal.ai", number>()
  /**
   * Ротация портретов внутри одного ролика: счётчик использования в БД растёт
   * только после снятой сцены, а сцены идут подряд — без этого набора все они
   * взяли бы один и тот же кадр (PROJECT_CONTEXT §7).
   */
  const usedAvatarPortraitIds = new Set<string>()
  /** Отпечатки аватарных кадров ролика — контроль дублей между его сценами. */
  const avatarFrameHashes: AvatarClipFrameRecord[] = []
  const sourceCleanup: string[] = []
  const sceneRecords: LipSyncSceneRecord[] = []
  const assetsDir = getAssetsDirFor(videoId)
  await mkdir(assetsDir, { recursive: true })

  /**
   * Пишет накопленный прогресс в шаг. Вызывается после каждой оплаченной сцены,
   * иначе обрыв в середине шага (упавшая заливка, перезапуск воркера) стирал бы
   * весь смысл переиспользования: снапшот оставался null и следующий заход платил
   * за уже готовые сцены второй раз. Записи прошлых попыток подмешиваются, чтобы
   * не потерять сцены, до которых этот прогон ещё не дошёл.
   */
  const persistProgress = async (extra: Record<string, unknown> = {}): Promise<void> => {
    await updateStep(step.id, {
      outputSnapshot: {
        // status здесь не пишем: шаг ещё не завершён, а ветка идемпотентности
        // смотрит в снапшот только у completed-шага.
        clipPaths: [...updatedClipPaths],
        syncedSceneCount,
        resyncedSceneCount,
        totalCostUsd,
        modelId: model.id,
        scenes: mergeSceneRecords(previousByIndex, sceneRecords),
      },
      // accumulate, а не перезапись: прогон, где все сцены переиспользованы
      // (totalCostUsd=0), не должен стирать деньги, потраченные прошлой попыткой.
      actualCost: accumulateStepCost(costBefore, totalCostUsd),
      ...extra,
    })
  }

  /**
   * Запись-отказ по сцене: синхронизировать нельзя, и это НЕ «до сцены не дошли».
   *
   * Без такой записи ранняя идемпотентность не выполнялась никогда (сцена без клипа
   * или с длительностью вне диапазона модели просто отсутствовала в снапшоте), шаг
   * терял кэш навсегда и каждый прогон заново гонял TTS и probe по остальным сценам.
   * Отказ привязан к тому же reuseKey, что и успех: перегенерация клипа меняет
   * отпечаток, и сцена честно получает новую попытку.
   */
  const recordSkippedScene = (params: {
    sceneOrder: number
    sceneIndex: number
    reason: LipSyncSkipReason
    sourcePath?: string | null
    reuseKey?: string | null
    spokenLineHash?: string | null
    durationSec?: number | null
  }): void => {
    sceneRecords.push({
      sceneOrder: params.sceneOrder,
      sceneIndex: params.sceneIndex,
      sourcePath: params.sourcePath ?? "",
      outputPath: null,
      audioPath: null,
      spokenLineHash: params.spokenLineHash ?? null,
      reuseKey: params.reuseKey ?? null,
      durationSec: params.durationSec ?? 0,
      skipped: params.reason,
    })
  }

  let ledgerFlushed = false
  /**
   * Одна строка ledger на (видео × шаг × сервис × попытку) — cost-ledger дедуплицирует
   * именно так, поэтому писать по сцене нельзя: в ledger попала бы только первая.
   * Флашим агрегат и на успехе, и на падении — расходы прерванной попытки обязаны
   * попасть в burn-rate, иначе он систематически занижен.
   */
  const flushCostLedger = async (): Promise<void> => {
    if (ledgerFlushed) return
    ledgerFlushed = true
    for (const [service, costUsd] of costByService) {
      await logStepCost(step.id, STEP_KEY, service, costUsd, videoId, model.id, { attempt })
    }
  }

  try {
    for (const scene of lipSyncTargets) {
      const sceneIndex = sceneIndexOf(scene)
      if (sceneIndex === undefined) {
        await appendStepLog(step.id, `Сцена order=${scene.order}: клип не сопоставлен с фактическим порядком нарезки — пропускаю (позиционная догадка отдала бы чужой клип)`)
        continue
      }
      // Индекс из снапшота prompt_generation, длина — из снапшота clip_generation.
      // При их рассинхроне присваивание по индексу за границей массива расширяло его
      // дырами (undefined), и эти дыры уезжали в сборку как пути клипов.
      if (!isAssignableClipIndex(sceneIndex, updatedClipPaths.length)) {
        await appendStepLog(
          step.id,
          `Сцена order=${scene.order}: индекс клипа ${sceneIndex} вне списка из ${updatedClipPaths.length} путей (рассинхрон снапшотов clip_generation и prompt_generation) — пропускаю`,
        )
        // Отпечатка нет: исходника у сцены не существует, привязывать отказ не к чему.
        // Появятся клипы — появится и ключ, и отказ перестанет закрывать сцену.
        recordSkippedScene({ sceneOrder: scene.order, sceneIndex, reason: "clip_index_out_of_range" })
        continue
      }
      const sceneTag = `Сцена order=${scene.order} (index=${sceneIndex})`

      // Клип этой сцены в БД лежит с order = sceneIndex (0-based индекс генерации).
      const clipAsset = await prisma.videoAsset.findFirst({
        where: { videoId, type: "clip" as never, order: sceneIndex },
      })
      const previous = previousByIndex.get(sceneIndex)
      const resolvedSource = resolveSceneSourcePath({
        sceneIndex,
        clipPaths,
        assetFilePath: clipAsset?.filePath,
        snapshotSourcePath: previous?.sourcePath,
      })
      // Сцену снимает ведущая — сгенерированного клипа под неё нет и быть не должно.
      // Исходником станет фрагмент из библиотеки, он резервируется ниже.
      if (!resolvedSource.path && !presenterRouteAvailable) {
        await appendStepLog(step.id, `${sceneTag}: исходный клип не найден ни в clipPaths (${clipPaths.length} шт.), ни в БД — пропускаю`)
        recordSkippedScene({ sceneOrder: scene.order, sceneIndex, reason: "no_clip" })
        continue
      }
      if (resolvedSource.mismatch) {
        // Типовой случай: в БД уже лежит *_lipsync.mp4 после прошлого прогона.
        await appendStepLog(
          step.id,
          `${sceneTag}: filePath ассета (${basename(clipAsset?.filePath ?? "—")}) расходится с исходником ${basename(resolvedSource.path ?? "—")} [${resolvedSource.origin}] — синхронизирую оригинал`,
        )
      }

      const spokenLine = scene.spokenLine!.trim()
      const spokenLineHash = hashSpokenLine(spokenLine)
      const sourceAnchor = sourceAnchorFor(sceneIndex, resolvedSource.path)
      const reuseKey = await reuseKeyFor(spokenLine, sourceAnchor, trackSegmentKeyFor(scene.order))

      // Маршрут «монтаж от звука»: сцене нужен её кусок общего трека, а границы
      // куска даёт выравнивание. Сцены в выравнивании нет — синтезировать речь
      // заново нельзя: она прозвучит иначе трека под таймлайном, и губы уедут от
      // звука. Отказ пишем ДО ветки переиспользования и обязательно записью:
      // без неё в снапшоте остался бы outputPath прошлого (посценного) прогона,
      // а в путях клипов — сырой клип, и снапшот разошёлся бы с фактом.
      const alignedScene = audioFirst ? alignedSceneByOrder.get(scene.order) : undefined
      if (audioFirst && !alignedScene) {
        await appendStepLog(
          step.id,
          `${sceneTag}: в выравнивании нет границ этой сцены в общем треке — вырезать нечего, синхронизацию пропускаю (посценный синтез дал бы звук мимо трека)`,
        )
        recordSkippedScene({
          sceneOrder: scene.order,
          sceneIndex,
          reason: "track_segment_missing",
          sourcePath: resolvedSource.path,
          reuseKey,
          spokenLineHash,
        })
        continue
      }
      const segmentPlan = audioFirst && alignedScene ? planTrackSegment(alignedScene, audioFirst) : null

      // Переиспользование готового результата сцены: совпал ВЕСЬ отпечаток (текст,
      // исходник, персонаж, параметры синтеза) и файл на месте — повторно платить
      // за TTS и lip-sync незачем. Записи старого формата (reuseKey=null) не
      // переиспользуются: неизвестно, из чего они собраны.
      if (previous?.reuseKey && previous.reuseKey === reuseKey && previous.outputPath && await fileExists(previous.outputPath)) {
        updatedClipPaths[sceneIndex] = previous.outputPath
        sceneRecords.push({ ...previous, sceneOrder: scene.order, sceneIndex })
        syncedSceneCount++
        reusedSceneCount++
        await appendStepLog(step.id, `${sceneTag}: переиспользую готовый lip-sync ${basename(previous.outputPath)} — повторной оплаты нет`)
        continue
      }
      if (previous?.outputPath && !previous.reuseKey) {
        await appendStepLog(
          step.id,
          `${sceneTag}: в снапшоте запись без отпечатка (старый формат) — синхронизирую заново, чтобы не подставить устаревший файл`,
        )
      }

      const plannedDurationSec = scene.durationSec || 5

      // Синтез речи как функция, а не как место в потоке: маршруту ведущей
      // длина речи нужна ДО подбора фрагмента, всем остальным — после проверок
      // источника. Повторный вызов ничего не делает и ничего не стоит.
      // Цель подбора фрагмента: по умолчанию план, для ведущей — измеренная речь.
      let presenterTargetSec = plannedDurationSec
      let speechReady = false
      // Звук сцены лежит в той же папке ассетов на обоих маршрутах, а различает их
      // отпечаток в имени: кусок трека — интервал и сам трек, посценный синтез —
      // текст и параметры голоса. Новый трек даёт новое имя, и старый кусок не
      // подставится под свежий звук.
      //
      // Отпечаток синтеза зашит в имя файла: тогда переиспользование не зависит от
      // снапшота шага, который жёсткий рестарт воркера записать не успевает. Файл на
      // месте — значит эта же фраза ТЕМ ЖЕ голосом уже синтезирована и оплачена.
      // Только хэша текста было мало: смена голоса/модели/языка/темпа давала другой
      // звук, а файл считался подходящим. На маршруте трека этот хэш не считается
      // вовсе — синтеза там нет.
      const audioPath = segmentPlan
        ? join(assetsDir, `scene_${sceneIndex}_track_${segmentPlan.identity.slice(0, 12)}.mp3`)
        : join(assetsDir, `scene_${sceneIndex}_spoken_${hashSpeechIdentity({
          spokenLine,
          voiceoverModelId: videoConfig.voiceoverModelId,
          voiceoverVoiceId: videoConfig.voiceoverVoiceId,
          voiceoverLanguage: videoConfig.voiceoverLanguage,
          voiceoverPacing: videoConfig.voiceoverPacing,
        }).slice(0, 12)}.mp3`)
      /**
       * Файл речи, который реально уедет в модель. Совпадает с синтезированным,
       * пока реплика влезает в исходник; длинную укладываем ускорением (см. ниже),
       * и тогда сюда встаёт ускоренная копия. Сам `audioPath` не трогаем — по нему
       * работает переиспользование синтеза между прогонами.
       */
      let speechPath = audioPath
      let ttsCost = 0
      /** Длительность вырезанного куска трека — измеренная, а не плановая. */
      let trackSegmentSec: number | null = null
      const ensureSpeech = async (): Promise<boolean> => {
        if (speechReady) return true
        if (await fileExists(audioPath)) {
          await appendStepLog(step.id, `${sceneTag}: переиспользую синтезированную реплику ${basename(audioPath)}`)
          speechReady = true
          return true
        }
        try {
          const tts = await synthesizeSpeech({
            text: spokenLine,
            outputPath: audioPath,
            modelId: videoConfig.voiceoverModelId,
            voiceId: videoConfig.voiceoverVoiceId,
            language: videoConfig.voiceoverLanguage,
            pacing: videoConfig.voiceoverPacing,
            videoId,
          })
          ttsCost = tts.costUsd
          speechReady = true
          return true
        } catch (err) {
          const msg = err instanceof Error ? err.message : "TTS failed"
          await appendStepLog(step.id, `${sceneTag}: TTS ошибка (${msg}) — оставляю оригинальный клип`)
          recordSkippedScene({
            sceneOrder: scene.order,
            sceneIndex,
            reason: "tts_failed",
            sourcePath: resolvedSource.path,
            reuseKey,
            spokenLineHash,
          })
          return false
        }
      }

      /**
       * Звук сцены на маршруте «монтаж от звука»: кусок уже оплаченного трека.
       * Платного вызова здесь нет вовсе — ttsCost остаётся нулём.
       */
      const ensureTrackSegment = async (): Promise<boolean> => {
        if (speechReady) return true
        const { cut } = segmentPlan!
        // Пустой интервал (выравнивание отдало нулевую сцену) — это тишина.
        // Отдать её в lip-sync значит оплатить съёмку молчащих губ. Причина
        // детерминированная: пока выравнивание то же, ответ будет тот же.
        if (!(cut.durationSec > 0)) {
          await appendStepLog(
            step.id,
            `${sceneTag}: интервал сцены в треке пуст (${cut.startSec.toFixed(2)}-${cut.endSec.toFixed(2)}с) — вырезать нечего, оставляю оригинальный клип`,
          )
          recordSkippedScene({
            sceneOrder: scene.order,
            sceneIndex,
            reason: "track_segment_empty",
            sourcePath: resolvedSource.path,
            reuseKey,
            spokenLineHash,
          })
          return false
        }
        // Молчать про подгонку нельзя: модель получит кусок не той длины, что дало
        // выравнивание. Новости при этом РАЗНЫЕ, и текст у них разный.
        if (cut.clampedToModel === "max") {
          // Ускорять звук под потолок модели мы на этом маршруте не имеем права —
          // под таймлайном лежит трек, и он эталон.
          await appendStepLog(
            step.id,
            `${sceneTag}: WARN интервал сцены длиннее потолка модели ${maxDurationSec}с — `
            + `беру ${cut.startSec.toFixed(2)}-${cut.endSec.toFixed(2)}с (${cut.durationSec.toFixed(2)}с), `
            + `хвост реплики в кадр не попадёт; звук остаётся эталоном`,
          )
        } else if (cut.clampedToModel === "min") {
          await appendStepLog(
            step.id,
            `${sceneTag}: интервал сцены ${(cut.endSec - cut.startSec).toFixed(2)}с короче минимума модели ${minDurationSec}с — `
            + `добиваю тишиной на ${cut.silencePadSec.toFixed(2)}с до ${cut.durationSec.toFixed(2)}с `
            + `(сдвигать границы в соседнюю сцену нельзя: губы произносили бы чужие слова)`,
          )
        }
        if (await fileExists(audioPath)) {
          trackSegmentSec = (await probeMediaDuration(audioPath)) ?? cut.durationSec
          await appendStepLog(step.id, `${sceneTag}: переиспользую вырезанный кусок трека ${basename(audioPath)}`)
          speechReady = true
          return true
        }
        try {
          const segment = await cutTrackSegment({
            trackPath: audioFirst!.trackPath,
            outputPath: audioPath,
            cut,
            probeDuration: probeMediaDuration,
          })
          trackSegmentSec = segment.durationSec
          speechReady = true
          await appendStepLog(
            step.id,
            `${sceneTag}: вырезал ${cut.startSec.toFixed(2)}-${cut.endSec.toFixed(2)}с общего трека `
            + `(${segment.durationSec.toFixed(2)}с) — синтез не нужен и не оплачивается`,
          )
          return true
        } catch (err) {
          const msg = err instanceof Error ? err.message : "cut failed"
          await appendStepLog(step.id, `${sceneTag}: не удалось вырезать кусок трека (${msg}) — оставляю оригинальный клип`)
          recordSkippedScene({
            sceneOrder: scene.order,
            sceneIndex,
            reason: "track_segment_failed",
            sourcePath: resolvedSource.path,
            reuseKey,
            spokenLineHash,
          })
          return false
        }
      }

      /** Звук сцены: кусок общего трека на новом маршруте, посценный синтез на прежнем. */
      const ensureSceneAudio = async (): Promise<boolean> =>
        segmentPlan ? ensureTrackSegment() : ensureSpeech()

      let sourceVideoPath: string | null = resolvedSource.path
      let presenterSourcePath: string | null = null
      /**
       * Аватарный маршрут: сцену снимет `speech_to_video` уже ПОСЛЕ синтеза
       * речи — модели нужен готовый звук, а не только портрет. Поэтому здесь
       * только решение о маршруте, а сама съёмка ниже, за TTS.
       */
      let useAvatarRoute = false
      if (videoConfig.lipSyncCharacterId) {
        // Длина речи известна только после синтеза, и именно она — цель
        // подбора. План сцены это намерение сценариста: реплика на 77 символов
        // звучит 5.9 с, а сцена планируется на 9-10. Фрагмент под план оставлял
        // немой хвост, где ведущая говорит без звука (ролик 21: 20 с из 50).
        if (!(await ensureSceneAudio())) continue
        if (segmentPlan) {
          // Монтаж от звука: цель подбора — длина ВЫРЕЗАННОГО куска. Она уже
          // зажата в диапазон модели планировщиком, ускорять и подгонять нечего.
          presenterTargetSec = trackSegmentSec ?? segmentPlan.cut.durationSec
          await appendStepLog(
            step.id,
            `${sceneTag}: ищу фрагмент ведущего под кусок трека ${presenterTargetSec.toFixed(2)}с`,
          )
        } else {
          const speechDurationSec = await probeMediaDuration(audioPath)
          // Реплика может звучать дольше, чем модель готова принять исходник
          // (kling-lip-sync — 10 с). Фрагмента такой длины в библиотеке нет и быть
          // не может, поэтому фрагмент ищем под УСКОРЕННУЮ речь: 11.55 с при 1.2x
          // это 9.6 с, и фраза остаётся целой. Сам файл ускоряем ниже, когда
          // известен фактический исходник.
          const preFit = planSpeechFitToModel(speechDurationSec ?? 0, maxDurationSec)
          const fittedSpeechSec = speechDurationSec === null
            ? null
            : speechDurationSec / preFit.speedFactor
          presenterTargetSec = presenterTargetDuration(fittedSpeechSec, plannedDurationSec)
          if (speechDurationSec === null) {
            await appendStepLog(step.id, `${sceneTag}: длительность реплики не измеряется — ищу фрагмент по плану ${plannedDurationSec}с`)
          } else if (preFit.speedFactor > 1) {
            await appendStepLog(
              step.id,
              `${sceneTag}: реплика ${speechDurationSec.toFixed(2)}с длиннее потолка модели ${maxDurationSec}с — `
              + `ищу фрагмент под ускоренную речь ${fittedSpeechSec!.toFixed(2)}с (${preFit.speedFactor.toFixed(2)}x)`
              + (preFit.fits ? "" : `; даже ${MAX_SPEECH_SPEEDUP}x не хватает, часть фразы не поместится`),
            )
          }
        }

        // Переключатель маршрута стенда: сравнить липсинк по живой съёмке с
        // аватаром можно только на одном сценарии, а по умолчанию живой
        // фрагмент выигрывает всегда и аватарная ветка не запускается вовсе.
        if (presenterRoutePrefersAvatar(process.env)) {
          const hasPortrait = await characterHasAvatarPortrait(videoConfig.lipSyncCharacterId)
            .catch(() => false)
          useAvatarRoute = planPresenterSourceStrategy({
            hasLibraryClip: true,
            hasPortrait,
            hasGeneratedClip: !!resolvedSource.path,
            preferAvatar: true,
          }) === "avatar"
          await appendStepLog(step.id, useAvatarRoute
            ? `${sceneTag}: PRESENTER_ROUTE=avatar — сцену снимает AI-аватар из портрета персонажа`
            : `${sceneTag}: PRESENTER_ROUTE=avatar, но портрета у персонажа нет — иду прежним маршрутом`)
        }

        const sourceClip = useAvatarRoute ? null : await reservePresenterSourceClip({
          characterId: videoConfig.lipSyncCharacterId,
          durationSec: presenterTargetSec,
          minDurationSec,
          maxDurationSec,
        })
        if (sourceClip) {
          const sourceExt = extname(sourceClip.name || sourceClip.fileUrl).toLowerCase()
          const safeExt = [".mp4", ".mov", ".webm"].includes(sourceExt) ? sourceExt : ".mp4"
          const localSourcePath = join(assetsDir, `presenter_${sceneIndex}_${sourceClip.id}${safeExt}`)
          if (sourceClip.storageKey) {
            await getStorageDriver().downloadToFile(sourceClip.storageKey, localSourcePath)
          } else {
            await downloadFile(sourceClip.fileUrl, localSourcePath)
          }
          sourceVideoPath = localSourcePath
          presenterSourcePath = localSourcePath
          sourceCleanup.push(localSourcePath)
          await appendStepLog(step.id, `${sceneTag}: presenter source ${sourceClip.id} (${sourceClip.durationSec}s)`)
        } else if (!useAvatarRoute) {
          // Библиотека не дала фрагмента. Порядок дальнейшего выбора — в
          // planPresenterSourceStrategy: портрет есть — сцену снимет аватар,
          // портрета нет — остаётся прежний путь, сгенерированный клип.
          const hasPortrait = await characterHasAvatarPortrait(videoConfig.lipSyncCharacterId)
            .catch(() => false)
          const strategy = planPresenterSourceStrategy({
            hasLibraryClip: false,
            hasPortrait,
            hasGeneratedClip: !!resolvedSource.path,
          })

          if (strategy === "avatar") {
            useAvatarRoute = true
            await appendStepLog(
              step.id,
              `${sceneTag}: библиотека ведущего пуста — сцену снимет AI-аватар из портрета персонажа`,
            )
          } else {
            await appendStepLog(step.id, `${sceneTag}: нет активного исходника ведущего под речь ${presenterTargetSec.toFixed(2)}с (диапазон модели ${minDurationSec}-${maxDurationSec}с), беру сгенерированный клип`)
          }
        }
      }

      // Ролик ведущей: сгенерированного клипа под сцену нет и не будет. Без
      // фрагмента ведущей в ролике осталась бы дыра — честнее уронить шаг, чем
      // молча собрать видео без сцены.
      if (!sourceVideoPath && !useAvatarRoute) {
        throw new Error(
          `${sceneTag}: нет ни фрагмента ведущего, ни портрета, ни сгенерированного клипа — собирать нечего`,
        )
      }

      // Реальная длительность файла, а не плановая: модель работает с тем, что ей отдали,
      // и по ней же считается стоимость. Плановая длительность здесь врёт при любом
      // подставленном исходнике ведущего и при клипе, удлинённом под voiceover.
      // Замер строгий (probeMediaDuration): неизмеримый файл даёт null, а не «5 секунд».
      //
      // У аватарной сцены исходного видео нет вовсе: длину задаёт синтезированная
      // речь, и она измеряется ниже, после TTS.
      let measuredDurationSec = useAvatarRoute ? null : await probeMediaDuration(sourceVideoPath!)

      // Подменённый исходник ведущего диктует длину сцены в сборке, поэтому его
      // расхождение с планом проверяем отдельно: диапазон модели такое не ловит —
      // 2.5-секундный клип для сцены на 9 с формально «в 2-10 с», а по факту минус
      // 6.5 с хронометража. Метаданные в БД могут врать, поэтому сверяем измеренное.
      // Неизмеримый исходник ведущего тоже отбрасываем — доверять ему нечем.
      // Откатываться есть куда только там, где сгенерированный клип существует:
      // у ролика ведущей запасного исходника нет вовсе, и подменять его нечем.
      if (presenterSourcePath && resolvedSource.path && (measuredDurationSec === null || !isSourceDurationCloseToScene(measuredDurationSec, presenterTargetSec))) {
        await appendStepLog(
          step.id,
          measuredDurationSec === null
            ? `${sceneTag}: длительность исходника ведущего не измеряется (нет файла или ffprobe) — возвращаюсь на сгенерированный клип`
            : `${sceneTag}: исходник ведущего ${measuredDurationSec.toFixed(2)}с расходится с длиной речи ${presenterTargetSec.toFixed(2)}с — возвращаюсь на сгенерированный клип`,
        )
        sourceVideoPath = resolvedSource.path
        presenterSourcePath = null
        measuredDurationSec = await probeMediaDuration(sourceVideoPath)
      }

      if (measuredDurationSec === null && !useAvatarRoute) {
        // Раньше здесь молча подставлялась плановая длительность (а до неё —
        // дефолтные 5 с из probeClipDurations): битый или отсутствующий файл уезжал
        // в модель с выдуманной длиной, и проверка диапазона ничего не проверяла.
        //
        // probeMediaDuration отдаёт null на ЛЮБОЙ неудаче ffprobe, а неудачи бывают
        // двух разных природ. Нет файла — это свойство материала: сколько ни
        // перезапускай, ответ тот же, и такую сцену честно закрываем, иначе шаг
        // теряет кэш и каждый прогон заново гоняет probe и TTS по остальным сценам.
        // Файл на месте, а замер не состоялся — это среда (ffprobe не запустился,
        // spawn EAGAIN/EMFILE под нагрузкой, свежескачанный mp4 держит антивирус):
        // такой отказ кэш НЕ открывает, иначе один неудачный прогон навсегда и молча
        // лишал бы ролик lip-sync по этой сцене.
        const sourceExists = await fileExists(sourceVideoPath!)
        await appendStepLog(
          step.id,
          sourceExists
            ? `${sceneTag}: не удалось измерить длительность источника ${basename(sourceVideoPath!)} — файл на месте, значит подвела среда (ffprobe недоступен, файл занят, битые метаданные); оставляю оригинальный клип, следующий прогон попробует снова`
            : `${sceneTag}: не удалось измерить длительность источника ${basename(sourceVideoPath!)} — файла нет на диске, измерять нечего; оставляю оригинальный клип`,
        )
        recordSkippedScene({
          sceneOrder: scene.order,
          sceneIndex,
          reason: sourceExists ? "source_unmeasurable" : "source_missing",
          sourcePath: resolvedSource.path,
          reuseKey,
          spokenLineHash,
        })
        continue
      }

      // Диапазон длительности — требование модели lip-sync к ИСХОДНОМУ видео.
      // У аватарной сцены исходного видео нет: длину задаёт речь, а потолок
      // проверяет спека speech_to_video при сборке payload.
      if (!useAvatarRoute && !isDurationWithinModelRange(measuredDurationSec!, minDurationSec, maxDurationSec)) {
        await appendStepLog(
          step.id,
          `${sceneTag}: реальная длительность источника ${measuredDurationSec!.toFixed(2)}с вне диапазона модели ${minDurationSec}-${maxDurationSec}с (допуск ±${MODEL_DURATION_TOLERANCE_SEC}с) — оставляю оригинальный клип`,
        )
        recordSkippedScene({
          sceneOrder: scene.order,
          sceneIndex,
          reason: "duration_out_of_range",
          sourcePath: resolvedSource.path,
          reuseKey,
          spokenLineHash,
          durationSec: measuredDurationSec,
        })
        continue
      }

      // В провайдер уходит длительность, зажатая в диапазон модели: измеренные 10.03 с
      // мы приняли по допуску, но runLipSync валидирует строго и уронил бы вызов.
      // Расхождение с измеренным здесь всегда в пределах допуска, на стоимость не влияет.
      const providerDurationSec = useAvatarRoute
        ? 0
        : clampDurationToModelRange(measuredDurationSec!, minDurationSec, maxDurationSec)

      // Речь синтезируется ровно один раз за сцену — где бы её ни попросили
      // первой. Маршруту ведущей она нужна РАНЬШЕ подбора фрагмента (длина
      // речи и есть цель подбора), остальным — как прежде, после проверок
      // источника, чтобы не платить за синтез сцены, которую всё равно
      // пропустим.
      if (!(await ensureSceneAudio())) continue

      // Кусок трека длиннее картинки, в которую его вкладывают: lip-sync отдаст
      // ролик длиной ИСХОДНИКА и хвост речи срежет. Ускорить кусок мы не имеем
      // права (см. ниже), но и молчать нельзя — на прежнем маршруте об этом
      // говорила ветка ускорения, и без этой строки сигнал пропал бы совсем.
      if (segmentPlan && !useAvatarRoute && segmentPlan.cut.durationSec > providerDurationSec) {
        await appendStepLog(
          step.id,
          `${sceneTag}: WARN кусок трека ${segmentPlan.cut.durationSec.toFixed(2)}с длиннее исходника `
          + `${providerDurationSec.toFixed(2)}с — модель срежет речь по длине картинки; `
          + `исходник под звук нарезает план 2`,
        )
      }

      /**
       * Речь длиннее исходника: lip-sync отдаёт ролик длиной ИСХОДНИКА, и всё,
       * что не поместилось, просто пропадает — фраза обрывается на середине.
       * Укладываем ускорением до 1.2x, как это делает шаг озвучки с закадровой
       * репликой. Аватарной сцены это не касается: там длину задаёт сама речь.
       *
       * Кусок общего трека не ускоряется НИКОГДА: под таймлайном лежит трек, и
       * ускоренная копия разошлась бы с ним по звуку. Длину диктует звук, а
       * подгонка картинки под него — нарезка исходника ведущего (план 2); кусок
       * длиннее потолка модели уже зажат планировщиком, и об этом сказано в лог.
       */
      if (!useAvatarRoute && !segmentPlan) {
        const speechSec = await probeMediaDuration(audioPath)
        const fit = planSpeechFitToModel(speechSec ?? 0, providerDurationSec)
        if (fit.speedFactor > 1) {
          try {
            const fittedPath = audioPath.replace(/\.mp3$/i, "_fit.mp3")
            const fitted = await adjustAudioTempo(audioPath, fittedPath, fit.speedFactor)
            speechPath = fitted.outputPath
            await appendStepLog(
              step.id,
              `${sceneTag}: реплика ${speechSec!.toFixed(2)}с не влезает в исходник ${providerDurationSec.toFixed(2)}с — `
              + `ускоряю в ${fit.speedFactor.toFixed(2)}x до ${fitted.durationSec.toFixed(2)}с`
              + (fit.fits ? "" : `; предел ${MAX_SPEECH_SPEEDUP}x, хвост фразы модель всё же срежет`),
            )
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            await appendStepLog(
              step.id,
              `${sceneTag}: ускорить реплику не удалось (${msg.slice(0, 160)}) — модель срежет её по длине исходника`,
            )
          }
        }
      }

      // 2. Картинка сцены. Живую съёмку синхронизирует lip-sync, аватарную
      // сцену целиком снимает speech_to_video — там речь уже в кадре и в
      // звуковой дорожке, и второй платный шаг не нужен.
      const renderedPath = join(assetsDir, `scene_${sceneIndex}_lipsync.mp4`)
      let renderCostUsd: number
      let renderProvider: string
      let renderModelId: string

      if (useAvatarRoute) {
        // Длину сцены задаёт синтезированная речь: по ней считаются и деньги,
        // и таймлайн сборки.
        const audioDurationSec = await probeMediaDuration(audioPath)
        if (audioDurationSec === null) {
          await appendStepLog(step.id, `${sceneTag}: длительность синтезированной реплики не измеряется — сцену аватаром не снимаю`)
          recordSkippedScene({
            sceneOrder: scene.order,
            sceneIndex,
            reason: "source_unmeasurable",
            sourcePath: resolvedSource.path,
            reuseKey,
            spokenLineHash,
          })
          continue
        }

        const avatar = await generateAvatarSourceClip({
          characterId: videoConfig.lipSyncCharacterId!,
          videoId,
          stepId: step.id,
          unitKey: `avatar_scene_${sceneIndex}`,
          // Индекс сцены, а не scene.order: клипы и ассеты ролика адресуются
          // индексом, а order из плана AI умеет повторяться — на дубле две
          // сцены делили бы один объект в хранилище.
          sceneOrder: sceneIndex,
          audioPath,
          durationSec: audioDurationSec,
          resolution: videoConfig.format === "landscape" ? "1080p" : "1080p",
          outputPath: renderedPath,
          workDir: assetsDir,
          usedPortraitIds: [...usedAvatarPortraitIds],
        }).catch(async (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          await appendStepLog(step.id, `${sceneTag}: аватарная сцена не снята (${msg})`)
          return null
        })

        if (!avatar) {
          recordSkippedScene({
            sceneOrder: scene.order,
            sceneIndex,
            reason: "lip_sync_failed",
            sourcePath: resolvedSource.path,
            reuseKey,
            spokenLineHash,
            durationSec: audioDurationSec,
          })
          continue
        }

        measuredDurationSec = avatar.effectiveDurationSec
        renderCostUsd = avatar.costUsd
        renderProvider = avatar.provider
        renderModelId = avatar.modelId
        usedAvatarPortraitIds.add(avatar.portraitId)
        await appendStepLog(
          step.id,
          `${sceneTag}: AI-аватар из портрета ${avatar.portraitId} (${avatar.effectiveDurationSec.toFixed(2)}с, ${avatar.modelId}, $${avatar.costUsd.toFixed(3)}) — lip-sync не нужен, речь уже в кадре`,
        )

        // Контроль похожести внутри ролика: гейт уникальности сравнивает
        // готовый ролик с прошлыми публикациями и не видит, что все его сцены
        // показывают один кадр. Это предупреждение, а не блокировка —
        // оплаченный клип выбрасывать нельзя, решение принимает гейт.
        if (avatar.frameHash) {
          const twin = findSimilarAvatarClip(avatar.frameHash, avatarFrameHashes)
          if (twin) {
            await appendStepLog(
              step.id,
              `${sceneTag}: WARN кадр аватара повторяет сцену ${twin.sceneIndex} (расстояние ${twin.distance} бит) — ролику не хватает портретов персонажа`,
            )
          }
          avatarFrameHashes.push({ sceneIndex, hash: avatar.frameHash })
        }
      } else {
        // Replicate по умолчанию; fal.ai доступен только как явно включённый fallback.
        let lipSyncResult: Awaited<ReturnType<typeof runLipSync>>
        try {
          lipSyncResult = await runLipSync({
            videoId,
            videoAssetId: clipAsset?.id ?? null,
            sceneOrder: scene.order,
            sourceVideoPath: sourceVideoPath!,
            audioPath: speechPath,
            outputPath: renderedPath,
            durationSec: providerDurationSec,
            modelId: model.id,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : "lip-sync failed"
          await appendStepLog(step.id, `${sceneTag}: lip-sync ошибка (${msg}) — оставляю оригинальный клип`)
          recordSkippedScene({
            sceneOrder: scene.order,
            sceneIndex,
            reason: "lip_sync_failed",
            sourcePath: resolvedSource.path,
            reuseKey,
            spokenLineHash,
            durationSec: measuredDurationSec,
          })
          continue
        }
        renderCostUsd = lipSyncResult.costUsd
        renderProvider = lipSyncResult.provider
        renderModelId = model.id
      }

      // Оплачено — фиксируем ДО заливки в storage: uploadLocalAsset умеет упасть,
      // и без записи прогресса следующий заход оплатил бы эту сцену второй раз.
      const service = renderProvider === "replicate" ? "replicate" : "fal.ai"
      costByService.set(service, (costByService.get(service) ?? 0) + renderCostUsd + ttsCost)
      totalCostUsd += renderCostUsd + ttsCost
      syncedSceneCount++
      resyncedSceneCount++

      // Подстановка строго по индексу сцены: сравнение строк ломалось, как только
      // в БД оказывался путь прошлого прогона (findIndex возвращал -1).
      updatedClipPaths[sceneIndex] = renderedPath
      sceneRecords.push({
        sceneOrder: scene.order,
        sceneIndex,
        // Исходник ведущей (и аватарной сцены) в снапшот НЕ пишем: фрагмент
        // резервируется заново на каждом прогоне и удаляется в finally. Его путь
        // сделал бы отпечаток сцены нестабильным — следующий заход не узнал бы
        // уже готовую сцену и оплатил бы её второй раз. Пустая строка — ровно то,
        // что увидит resolveSceneSourcePath, и якорь останется синтетическим.
        sourcePath: (presenterSourcePath || useAvatarRoute) ? "" : (sourceVideoPath ?? renderedPath),
        outputPath: renderedPath,
        // Тот файл, который реально ушёл в модель: у длинной реплики это её
        // ускоренная копия.
        audioPath: speechPath,
        spokenLineHash,
        reuseKey,
        // К этой точке длительность известна в обоих маршрутах: у съёмки её
        // дал ffprobe и проверил диапазон, у аватара — длина синтезированной речи.
        durationSec: measuredDurationSec!,
      })
      await persistProgress()

      // Заливаем lip-synced клип в storage. filePath у VideoAsset(type=clip) НЕ трогаем:
      // ассет обязан продолжать указывать на оригинал, иначе повторный заход (и
      // idempotency-ветка runClipGeneration) подсунет уже синхронизированный файл
      // как источник — синхронизация ляжет поверх синхронизации.
      const renderStorage = await uploadLocalAsset(
        renderedPath,
        StorageKeys.videoLipSyncClip(videoId, basename(renderedPath)),
        "video/mp4",
      )

      // Сцена ведущей: клипа в БД под неё нет — clip_generation его не делал.
      // Создаём здесь, и filePath указывает на lip-sync результат: оригинала,
      // который надо было бы защищать от повторной синхронизации, не существует,
      // а `isLipSyncOutputPath` не даст взять этот файл источником на следующем
      // прогоне. Без записи в БД сцена невидима для сборки и переиспользования.
      if (!clipAsset) {
        await prisma.videoAsset.create({
          data: {
            videoId,
            type: "clip" as never,
            prompt: spokenLine.slice(0, 500),
            filePath: renderedPath,
            fileUrl: storageKeyToLegacyUrl(renderStorage.storageKey),
            order: sceneIndex,
            duration: measuredDurationSec,
            ...renderStorage,
          },
        })
      }

      await appendStepLog(
        step.id,
        `${sceneTag}: ${renderProvider} ${useAvatarRoute ? "аватарная сцена" : "lip-sync"} готова за ${measuredDurationSec!.toFixed(2)}s (${renderModelId} $${renderCostUsd.toFixed(3)} + tts $${ttsCost.toFixed(3)}), storage ${renderStorage.storageKey}`,
      )
    }
  } catch (error) {
    // Обрыв в середине шага: то, что уже оплачено, обязано остаться в снапшоте и в
    // ledger. Иначе следующий прогон переоплатит готовые сцены, а burn-rate потеряет
    // всю прерванную попытку.
    const msg = error instanceof Error ? error.message : "lip-sync step failed"
    await persistProgress({ status: "failed", finishedAt: new Date(), errorMessage: msg.slice(0, 1000) })
    await flushCostLedger()
    await appendStepLog(
      step.id,
      `Lip-sync прерван (${msg}): сохранено ${sceneRecords.length} готовых сцен, стоимость попытки $${totalCostUsd.toFixed(3)}`,
    )
    throw error
  } finally {
    // Чистим только скачанные исходники ведущего. Аудио реплик остаётся на диске
    // намеренно — это оно позволяет пережить рестарт без повторной оплаты TTS.
    await Promise.allSettled(sourceCleanup.map(p => unlink(p).catch(() => {})))
  }

  // Последний рубеж: где сцену синхронизировать не удалось, возвращаем её исходный
  // клип. Ячейка, оставшаяся пустой и после этого, — сцена без видео вообще: она не
  // попадёт в ролик, и сказать об этом надо здесь, а не молча уронить ffmpeg.
  const emptyClipIndexes = findEmptyClipPathIndexes(updatedClipPaths)
  if (emptyClipIndexes.length > 0) {
    for (const index of emptyClipIndexes) {
      if (hasClipPath(clipPaths[index])) updatedClipPaths[index] = clipPaths[index]!
    }
    const stillEmpty = findEmptyClipPathIndexes(updatedClipPaths)
    await appendStepLog(
      step.id,
      `Пустые ячейки клипов на позициях ${emptyClipIndexes.join(", ")} — восстановлены исходники clip_generation где они есть`
      + (stillEmpty.length > 0
        ? `; сцены ${stillEmpty.join(", ")} остались без видео и в ролик не попадут`
        : ""),
    )
  }

  // Итоговый список — именно updatedClipPaths, а не выборка из БД по порядку:
  // filePath у VideoAsset обычных сцен намеренно продолжает указывать на
  // ОРИГИНАЛ (см. выше), и сборка по нему получила бы несинхронизированные клипы.
  const result: LipSyncStepResult = {
    status: "completed",
    clipPaths: updatedClipPaths,
    syncedSceneCount,
    resyncedSceneCount,
    totalCostUsd,
    modelId: model.id,
    // Записи прошлых попыток не выбрасываем: сцена, переиспользованная не в этом
    // прогоне, должна остаться в снапшоте, иначе следующий заход её переоплатит.
    scenes: mergeSceneRecords(previousByIndex, sceneRecords),
  }

  await updateStep(step.id, {
    status: "completed",
    finishedAt: new Date(),
    outputSnapshot: result as unknown as Record<string, unknown>,
    // accumulate: прогон 1 синхронизировал 5 сцен за $0.42, прогон 2 всё
    // переиспользовал (totalCostUsd=0) — перезапись обнулила бы стоимость шага
    // в отчёте totalCostActual. Явный rerunVideoStep обнуляет поле отдельно.
    actualCost: accumulateStepCost(costBefore, totalCostUsd),
  })
  await flushCostLedger()
  await appendStepLog(
    step.id,
    `Lip-sync завершён: ${syncedSceneCount} из ${lipSyncTargets.length} сцен синхронизировано (заново ${resyncedSceneCount}, переиспользовано ${reusedSceneCount}), стоимость $${totalCostUsd.toFixed(3)}`,
  )

  return result
}

/** Границы длительности источника берём из media-provider реестра, иначе — kling-дефолт. */
function resolveModelDurationRange(modelId: string): { minDurationSec: number; maxDurationSec: number } {
  try {
    const spec = resolveMediaModel("lip_sync", modelId)
    return {
      minDurationSec: spec.constraints.minDurationSec,
      maxDurationSec: spec.constraints.maxDurationSec,
    }
  } catch {
    // Модель не описана в реестре (например fal-фолбэк) — держим общие рамки 2-10 с.
    return { minDurationSec: FALLBACK_MIN_DURATION_SEC, maxDurationSec: FALLBACK_MAX_DURATION_SEC }
  }
}

/**
 * Отпечаток файла-исходника для ключа переиспользования: размер + mtime.
 * Путь клипа при перегенерации не меняется (scene_N_clip.mp4), так что без этого
 * «новый клип» неотличим от «тот же клип». Файла нет — null, и сцена честно
 * пересинхронизируется вместо переиспользования вслепую.
 */
async function readFileSignature(path: string): Promise<string | null> {
  try {
    const stats = await stat(path)
    return `${stats.size}:${Math.round(stats.mtimeMs)}`
  } catch {
    return null
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
