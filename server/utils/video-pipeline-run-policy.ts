/**
 * Чистые решения оркестратора видео-пайплайна: каскад перезапуска шага, доверие
 * кэшу озвучки и восстановление числа оплаченных единиц у упавшего шага.
 *
 * Всё без БД и сети — иначе эти правила проверялись бы только живым прогоном
 * с реальными платными вызовами.
 */

import type { StepKey } from "./video-pipeline-db"
import type { AlignedScene } from "./transcription/align"

/** Допуск, в пределах которого расхождение длин не стоит правки. */
const DURATION_TOLERANCE_SEC = 0.05
/** Расхождение больше этого — не подгон, а сбой генерации. */
const DURATION_FAILURE_SEC = 1

export interface DurationFit {
  action: "none" | "trim" | "hold_last_frame" | "fail"
  deltaSec: number
}

/**
 * Что делать, если клип оказался не той длины, что заказана.
 *
 * Правится ВИДЕО. Звук на audio-first не трогается никогда: он эталон
 * таймлайна, и любая правка звука сдвинула бы субтитры и границы всех
 * последующих кадров (spec §8).
 */
export function planDurationFit(input: {
  expectedSec: number
  actualSec: number
  toleranceSec?: number
}): DurationFit {
  const tolerance = input.toleranceSec ?? DURATION_TOLERANCE_SEC
  const deltaSec = input.actualSec - input.expectedSec
  const magnitude = Math.abs(deltaSec)

  if (magnitude <= tolerance) return { action: "none", deltaSec }
  if (magnitude > DURATION_FAILURE_SEC) return { action: "fail", deltaSec }
  return { action: deltaSec > 0 ? "trim" : "hold_last_frame", deltaSec }
}

/** Громкость родных дорожек клипов под озвучкой — зависит от маршрута. */
export function clipVolumeWithVoiceoverFor(editPipeline: boolean): number {
  return editPipeline ? 0 : 0.3
}

/**
 * Нужно ли мирить длину реплики с длиной клипа.
 *
 * На старом маршруте политика `voiceoverReconciliation` сжимает звук, режет его
 * или растягивает сцену. На audio-first мирить нечего: кадр нарезан по речи, а
 * подмена клипов файлами `*_ext.mp4` разошлась бы с таймлайном транскрипта.
 */
export function shouldReconcileVoiceover(editPipeline: boolean): boolean {
  return !editPipeline
}

/**
 * Ожидаемая (по треку) длительность каждого клипа в СКЛЕЙКЕ — маршрут «монтаж
 * от звука».
 *
 * Клипу отдаётся отрезок трека от старта ЕГО сцены до старта СЛЕДУЮЩЕЙ, а не
 * интервал самой сцены (`endSec - startSec`): интервал не включает паузу перед
 * следующей репликой, и подгонка клипа только под него оставила бы паузу
 * ничьей — сумма клипов не дотянула бы до длины трека, и рассинхрон копился бы
 * на паузах точно так же, как раньше копился на плановых длительностях
 * (вход ревью Task 9: «перебивки между кусками ведущего встают в таймлайн с
 * ПЛАНОВЫМИ длительностями»). Первому клипу достаётся всё от начала трека,
 * последнему — всё до его конца, поэтому сумма результата всегда равна
 * `trackDurationSec` — если каждая сцена ролика узнана выравниванием.
 *
 * Сцена, которой в `alignedScenes` нет (в тексте ролика её не было — ни
 * реплики в кадре, ни закадровой строки), в карту не попадает: подгонять её
 * не к чему, и `render.ts` пропустит такой клип без правки.
 */
export function computeAlignedClipTargetsSec(input: {
  alignedScenes: readonly AlignedScene[]
  trackDurationSec: number
  /** order сцены → её позиция в ИТОГОВОЙ (уплотнённой) склейке. */
  positionByOrder: ReadonlyMap<number, number>
  /** Сколько клипов в склейке — под этот размер строится результат. */
  clipCount: number
}): Array<number | null> {
  const result = new Array<number | null>(input.clipCount).fill(null)
  if (input.alignedScenes.length === 0 || !(input.trackDurationSec > 0)) return result

  const ordered = [...input.alignedScenes].sort((a, b) => a.startSec - b.startSec)

  for (let i = 0; i < ordered.length; i += 1) {
    const scene = ordered[i]!
    const position = input.positionByOrder.get(scene.order)
    if (position === undefined || position < 0 || position >= input.clipCount) continue

    const startBoundary = i === 0 ? 0 : scene.startSec
    const endBoundary = i === ordered.length - 1 ? input.trackDurationSec : ordered[i + 1]!.startSec
    result[position] = Math.max(0, endBoundary - startBoundary)
  }

  return result
}

/**
 * РЕАЛЬНЫЙ порядок выполнения шагов в runVideoPipeline.
 *
 * Отличается от STEP_ORDER: там lip_sync_generation стоит шестым, потому что это
 * персистентный stepIndex — его пишут ensureStep в runner'ах (lip-sync-runner
 * прибит к 5) и по нему UI сортирует таблицу шагов; переставить его значило бы
 * переписать историю уже сгенерированных роликов.
 *
 * Фактически lip-sync — шаг 4b, между клипами и озвучкой. Каскад перезапуска
 * обязан считаться именно по этому порядку:
 *  - rerun озвучки по STEP_ORDER сносил ещё и lip-sync, и оператор, захотевший
 *    просто переозвучить закадровый голос, платил за все kling-lip-sync заново;
 *  - rerun lip-sync, наоборот, НЕ сбрасывал озвучку, а её outputSnapshot хранит
 *    clipPaths удлинённых (extend_scene) клипов прошлого прогона — свежий
 *    lip-sync оплачивался и тут же затирался старыми файлами.
 */
export const STEP_EXECUTION_ORDER: readonly StepKey[] = [
  "prompt_generation",
  "image_generation",
  "clip_generation",
  "lip_sync_generation",
  "voiceover_generation",
  "music_generation",
  "assembly",
]

/**
 * Порядок маршрута audio-first (spec §3).
 *
 * Озвучка первой: она эталон времени, всё остальное строится по ней.
 * Транскрипция сразу за ней — без границ слов резать кадры не по чему.
 */
export const STEP_EXECUTION_ORDER_AUDIO_FIRST: readonly StepKey[] = [
  "prompt_generation",
  "voiceover_generation",
  "transcription",
  "image_generation",
  "clip_generation",
  "lip_sync_generation",
  "music_generation",
  "assembly",
]

/** Порядок исполнения по маршруту РОЛИКА, а не по глобальному флагу. */
export function executionOrderFor(editPipeline: boolean): readonly StepKey[] {
  return editPipeline ? STEP_EXECUTION_ORDER_AUDIO_FIRST : STEP_EXECUTION_ORDER
}

/** Шаги, которые обязан сбросить перезапуск с указанного. Пустой массив — шаг неизвестен. */
export function stepsToRerunFrom(stepKey: StepKey, editPipeline = false): StepKey[] {
  const order = executionOrderFor(editPipeline)
  const index = order.indexOf(stepKey)
  if (index < 0) return []
  return [...order.slice(index)]
}

/**
 * Шаги, чей outputSnapshot посчитан ОТ ФАЙЛОВ КЛИПОВ.
 *
 * Озвучка меряет клипы ffprobe'ом, из их длительностей строит таймлайн (старт
 * каждой реплики) и сводит по нему voiceover_mix — её снапшот привязан к
 * конкретным файлам клипов намертво.
 *
 * music_generation берёт длительность из плана, а не из клипов; у assembly кэша
 * нет вовсе (рендерит каждый раз). Сбрасывать их из-за подменённых клипов значило
 * бы заново оплачивать Mubert без единой причины.
 */
const CLIP_DERIVED_CACHE_STEPS: ReadonlySet<StepKey> = new Set<StepKey>(["voiceover_generation"])

/**
 * Шаги, чей кэш обесценился, потому что lip-sync выдал в этом прогоне новые файлы
 * клипов.
 *
 * Раньше оркестратор в этой ситуации отказывался только от clipPaths кэша озвучки,
 * а сам voiceover_mix брал оттуда же — микс оставался посчитанным по СТАРОМУ
 * (удлинённому политикой extend_scene) таймлайну, и звук уезжал относительно
 * картинки. Кэш шага невалиден целиком.
 *
 * Набор берём из штатного каскада «всё, что идёт после lip-sync», чтобы порядок
 * шагов не пришлось описывать вторым списком, и оставляем в нём только шаги с
 * клип-зависимым кэшем.
 */
export function stepsInvalidatedByFreshClips(lipSyncProducedNewClips: boolean, editPipeline = false): StepKey[] {
  if (!lipSyncProducedNewClips) return []
  return stepsToRerunFrom("voiceover_generation", editPipeline).filter(key => CLIP_DERIVED_CACHE_STEPS.has(key))
}

/**
 * Патч сброса шага, у которого обесценился только КЭШ.
 *
 * Основа — тот же STEP_RERUN_RESET_PATCH, которым сбрасывает шаги rerunVideoStep:
 * второго пути сброса в пайплайне быть не должно. Отличие ровно одно и намеренное —
 * actualCost не трогаем. Оператор ничего не перезапускал, ассеты шага остаются на
 * месте (реплики сцен шаг переиспользует и платит за TTS ноль), так что деньги
 * прошлых попыток обязаны остаться в отчёте: обнулить их значило бы занизить
 * потраченное по ролику.
 */
export function snapshotInvalidationPatch(
  rerunResetPatch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const patch = { ...rerunResetPatch }
  delete patch.actualCost
  return patch
}

export interface VoiceoverClipPathsDecision {
  /**
   * Шаг озвучки пересобрал результат в ЭТОМ прогоне, а не вернул снапшот.
   *
   * Признаётся по приросту attemptCount, и здесь это честно: runVoiceoverGeneration
   * инкрементит счётчик строго ПОСЛЕ ветки раннего возврата кэша, а сами clipPaths
   * шаг всегда строит из путей, которые ему передали. То есть прирост означает
   * ровно «вернувшиеся clipPaths посчитаны от клипов этого прогона», а не «шаг ещё
   * раз стартовал». Своего признака свежести шаг не отдаёт.
   */
  voiceoverRegenerated: boolean
  /**
   * ФАКТ: lip-sync создал в этом прогоне новые файлы клипов
   * (resyncedSceneCount > 0), а не поднял всё из снапшота.
   */
  lipSyncProducedNewClips?: boolean
  /**
   * Прирост attemptCount шага lip-sync.
   *
   * Фолбэк для вызовов без факта. Как основной признак он неверен: счётчик растёт и
   * когда шаг всё переиспользовал из снапшота (ранняя идемпотентность не сработала,
   * например из-за сцены, которую синхронизировать физически нельзя) — файлы при этом
   * не менялись, и удлинённые озвучкой клипы прошлого прогона остаются валидными.
   */
  lipSyncRegenerated?: boolean
}

/** Факты о прогоне lip-sync, по которым видно, менялись ли файлы клипов. */
export interface LipSyncRunFacts {
  status: "disabled" | "skipped" | "completed"
  /** Сколько сцен реально ушло в провайдер в этом прогоне. undefined — счётчика нет. */
  resyncedSceneCount?: number
}

/**
 * Появились ли в этом прогоне НОВЫЕ lip-sync файлы.
 *
 * Раньше оркестратор считал это по приросту attemptCount шага, и на самом частом
 * story-driven сценарии это врало: прогон, где lip-sync всё переиспользовал из
 * снапшота, счётчик всё равно увеличивал — а значит удлинённые озвучкой клипы
 * (extend_scene, *_ext.mp4) объявлялись «относящимися к прошлым клипам» и в сборку
 * уезжали НЕудлинённые файлы под озвучку, рассчитанную на удлинённые. Звук уезжал
 * относительно картинки.
 *
 * attemptCount остаётся фолбэком ровно для одного случая: результат пришёл из
 * снапшота старой версии, где счётчика пересинхронизаций ещё не было.
 */
export function didLipSyncProduceNewClips(facts: LipSyncRunFacts, attemptGrew: boolean): boolean {
  // Шаг не отработал вовсе — клипы он не трогал, что бы ни показывал счётчик попыток.
  if (facts.status !== "completed") return false
  if (typeof facts.resyncedSceneCount === "number") return facts.resyncedSceneCount > 0
  return attemptGrew
}

/**
 * Можно ли доверять clipPaths, вернувшимся из шага озвучки.
 *
 * Озвучка с политикой extend_scene удлиняет клипы и кладёт новые пути в
 * outputSnapshot. Если она вернула их из кэша, а lip-sync в этом же прогоне
 * создал новые файлы, пути указывают на удлинённые клипы ПРОШЛОГО lip-sync —
 * применить их значит выбросить только что оплаченный результат.
 *
 * И наоборот: lip-sync, который ничего не пересинхронизировал, кэш озвучки не
 * обесценивает — файлы те же самые.
 */
export function shouldApplyVoiceoverClipPaths(input: VoiceoverClipPathsDecision): boolean {
  const lipSyncTouchedClips = input.lipSyncProducedNewClips ?? input.lipSyncRegenerated ?? false
  return input.voiceoverRegenerated || !lipSyncTouchedClips
}

/**
 * Сколько единиц шаг успел сгенерировать (и оплатить), если он упал на середине.
 *
 * Упавший шаг generatedCount не возвращает — исключение летит до строк учёта, и
 * деньги упавшей попытки не попадали в ledger вообще. Считаем по приросту
 * VideoAsset этого типа: каждая скачанная картинка/клип создаёт свою запись.
 * Оценка снизу — сцена, упавшая уже после сабмита в fal, счётчик не увеличит;
 * это всё равно кратно честнее нуля.
 */
export function generatedUnitsFromAssetDelta(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0
  return Math.max(0, Math.floor(after) - Math.floor(before))
}

// ─── Подхват прерванных прогонов после рестарта процесса ──────────────────────

/**
 * Статусы, из которых ролик ещё можно довести возобновлением.
 *
 * Это ровно промежуточные значения VideoStatus: прогон стартовал и не дошёл ни
 * до completed, ни до терминальной ошибки. Терминальные (failed/timeout/
 * canceled/file_missing) сюда НЕ входят намеренно: их автоперезапуск означал бы
 * бесконечную оплату заведомо сломанного ролика, а ручная кнопка «возобновить»
 * у оператора и так есть.
 *
 * pending в списке потому, что все три места создания Video ставят его и тут же
 * запускают пайплайн fire-and-forget: упавший в этот момент процесс оставляет
 * ролик именно в pending, и это самый частый вид «висяка».
 */
export const RESUMABLE_VIDEO_STATUSES: readonly string[] = [
  "pending",
  "configuring",
  "generating_prompts",
  "generating_images",
  "generating_clips",
  "generating_voiceover",
  "generating_music",
  "assembling",
]

/**
 * Статусы workflow-прогона, при которых ролик трогать нельзя.
 *
 * pending/running — запуск либо крутится, либо возвращён в очередь
 * recoverOrphanedRuns; его нода видео при повторном исполнении СОЗДАЁТ новый
 * Video, так что параллельное возобновление старого — двойная оплата.
 * cancelled — оператор запуск отменил, доводить его ролики за деньги нельзя.
 * Терминальные success/failed/no_data блокировкой не являются: там ролик уже
 * никем не подхватится и остаётся сиротой навсегда.
 */
const BLOCKING_WORKFLOW_RUN_STATUSES: ReadonlySet<string> = new Set(["pending", "running", "cancelled"])

/** Ролик молчит дольше этого — прогона за ним нет, только запись в БД. */
export const STALLED_VIDEO_IDLE_MS = 10 * 60_000

/**
 * Возраст блокировки, после которого её владелец считается мёртвым.
 *
 * lockedAt — не heartbeat, а штамп владения: он ставится один раз при захвате и
 * больше не обновляется. Значит порог обязан быть заведомо больше самого долгого
 * честного прогона (клипы по нескольку минут на сцену + сборка), иначе мы сорвём
 * блокировку живого пайплайна и оплатим тот же ролик дважды. Три часа — с запасом.
 */
export const STALLED_VIDEO_STALE_LOCK_MS = 3 * 60 * 60_000

/**
 * Возраст прогона, после которого возобновлять уже бессмысленно.
 *
 * Защита от «фантома»: ролик, который переживает рестарты сутками, каждый раз
 * поднимался бы заново и жёг деньги. Такой лучше пометить ошибкой — он станет
 * виден оператору и останется доступен для ручного возобновления.
 */
export const STALLED_VIDEO_ABANDON_MS = 6 * 60 * 60_000

/**
 * Сколько роликов поднимаем за один проход.
 *
 * Каждое возобновление — полноценный платный пайплайн с походами в провайдеров.
 * После долгого простоя висяков может накопиться десятки; поднять их разом
 * значит выдать залп в rate limit и в кошелёк.
 */
export const STALLED_VIDEO_BATCH_LIMIT = 5

export type StalledVideoAction = "resume" | "skip" | "abandon"

export type StalledVideoReason =
  | "terminal_status"
  | "workflow_run_active"
  | "recent_activity"
  | "locked"
  | "batch_limit"
  | "recently_dispatched"
  | "attempts_exhausted"
  | "too_old"
  | "interrupted"

/** Всё, что нужно знать о ролике, чтобы решить его судьбу. Без Prisma-типов — правило чистое. */
export interface StalledVideoCandidate {
  id: number
  status: string
  isLocked: boolean
  /** Штамп владения блокировкой. null при isLocked=true — блокировка без владельца, считаем протухшей. */
  lockedAt: Date | null
  /** Момент, когда пайплайн дошёл до первого шага. null — не дошёл. */
  startedAt: Date | null
  createdAt: Date
  /** Последнее изменение записи: по нему видно, что за роликом кто-то есть. */
  updatedAt: Date
  /** Статус WorkflowRun, которому принадлежит ролик. null/undefined — ролик сам по себе. */
  workflowRunStatus?: string | null
  /** Есть ли шаг, у которого attemptCount дошёл до maxAttempts. */
  hasExhaustedStep?: boolean
  /**
   * Этот ролик уже поднимали недавно (или слишком много раз).
   *
   * Считает вызывающая сторона: счётчика восстановлений в схеме нет, он живёт в
   * памяти процесса. Правилу флаг нужен, чтобы такие ролики не съедали лимит
   * партии — иначе пятёрка «вечных» кандидатов навсегда заслонила бы остальные.
   */
  recentlyDispatched?: boolean
}

export interface StalledVideoDecision {
  videoId: number
  action: StalledVideoAction
  reason: StalledVideoReason
  /**
   * Перед действием нужно сорвать блокировку мёртвого прогона.
   *
   * Сам resumeVideoPipeline её не снимает, а runVideoPipeline на занятом ролике
   * просто бросит «уже запущен» — висяк с осиротевшей блокировкой не поднялся бы
   * никогда.
   */
  releaseStaleLock: boolean
}

export interface StalledVideoPolicyOptions {
  /** Текущее время, мс. Передаётся снаружи, чтобы правило оставалось чистым. */
  now: number
  idleMs?: number
  staleLockMs?: number
  abandonAfterMs?: number
  limit?: number
}

/** Возраст прогона: от старта пайплайна, а если он не начинался — от создания записи. */
function runAgeMs(candidate: StalledVideoCandidate, now: number): number {
  const anchor = candidate.startedAt ?? candidate.createdAt
  return now - anchor.getTime()
}

/**
 * Что делать с каждым роликом, застрявшим в промежуточном статусе.
 *
 * Возвращает решение на КАЖДОГО кандидата, а не только на подхватываемых:
 * причина отказа — половина ценности правила, по ней видно в логе, почему висяк
 * не поднялся, и её же проверяет тест.
 *
 * Порядок проверок важен: «за роликом кто-то есть» (свежая активность, живая
 * блокировка) сильнее любого повода его похоронить — иначе долгий, но здоровый
 * прогон получил бы failed прямо посреди работы.
 */
export function planStalledVideoRecovery(
  candidates: readonly StalledVideoCandidate[],
  options: StalledVideoPolicyOptions,
): StalledVideoDecision[] {
  const idleMs = options.idleMs ?? STALLED_VIDEO_IDLE_MS
  const staleLockMs = options.staleLockMs ?? STALLED_VIDEO_STALE_LOCK_MS
  const abandonAfterMs = options.abandonAfterMs ?? STALLED_VIDEO_ABANDON_MS
  const limit = options.limit ?? STALLED_VIDEO_BATCH_LIMIT
  const { now } = options

  const decisions: StalledVideoDecision[] = []
  let resumed = 0

  for (const candidate of candidates) {
    const skip = (reason: StalledVideoReason): void => {
      decisions.push({ videoId: candidate.id, action: "skip", reason, releaseStaleLock: false })
    }

    if (!RESUMABLE_VIDEO_STATUSES.includes(candidate.status)) {
      skip("terminal_status")
      continue
    }

    if (candidate.workflowRunStatus && BLOCKING_WORKFLOW_RUN_STATUSES.has(candidate.workflowRunStatus)) {
      skip("workflow_run_active")
      continue
    }

    if (now - candidate.updatedAt.getTime() < idleMs) {
      skip("recent_activity")
      continue
    }

    // Блокировка без штампа владения — сирота: снимать её некому, значит она наша.
    const lockAgeMs = candidate.lockedAt ? now - candidate.lockedAt.getTime() : Number.POSITIVE_INFINITY
    const lockIsStale = lockAgeMs >= staleLockMs
    if (candidate.isLocked && !lockIsStale) {
      skip("locked")
      continue
    }

    const releaseStaleLock = candidate.isLocked

    // Хоронить помечаем ДО лимита партии: это дешёвый UPDATE без походов в
    // провайдеров, и откладывать его на следующий проход незачем.
    if (candidate.hasExhaustedStep) {
      decisions.push({ videoId: candidate.id, action: "abandon", reason: "attempts_exhausted", releaseStaleLock })
      continue
    }

    if (runAgeMs(candidate, now) >= abandonAfterMs) {
      decisions.push({ videoId: candidate.id, action: "abandon", reason: "too_old", releaseStaleLock })
      continue
    }

    // Проверяем ПОСЛЕ правил захоронения: ролик, который мы уже поднимали и
    // который всё равно висит, обязан дожить до пометки, а не выпадать из
    // рассмотрения навсегда.
    if (candidate.recentlyDispatched) {
      skip("recently_dispatched")
      continue
    }

    if (resumed >= limit) {
      skip("batch_limit")
      continue
    }

    resumed += 1
    decisions.push({ videoId: candidate.id, action: "resume", reason: "interrupted", releaseStaleLock })
  }

  return decisions
}
