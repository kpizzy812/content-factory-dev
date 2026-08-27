/**
 * Полная перегенерация трека озвучки — правила, по которым её вообще пускают.
 *
 * Это самая дорогая кнопка озвучки. Она пересинтезирует ВЕСЬ трек, а вместе с
 * ним меняет отпечаток файла (`trackFingerprint`), по которому считаются ключи
 * кусков в `segmentIdentity`: обесцениваются все аватарные кадры ролика.
 * Правка одной фразы через `segment-replace-runner` стоит ~$0.08, эта кнопка —
 * ~$14 на ролике из двадцати сцен. Отсюда три правила, и все три живут здесь:
 *
 *  1. **Молчаливого пути к ней нет.** Без `confirmExpensive` — отказ с числами:
 *     сколько кадров придётся собрать заново и во что это обойдётся (§4.5).
 *  2. **Повторный заход не платит второй раз** (`AGENTS.md`). Трек, уже
 *     соответствующий текущему сценарию и голосу, не пересинтезируется: у этой
 *     операции нет содержательного результата, кроме нового счёта. Именно
 *     поэтому локальная замена фразы обязана писать новый текст в сценарий —
 *     иначе перегенерация не увидит расхождения и вернула бы старую фразу.
 *  3. **Второй клик, пока прогон ещё идёт, ничего не сбрасывает.** Шаг в работе
 *     означает, что перегенерация уже запущена; повторный сброс снёс бы
 *     состояние живого прогона, а повторный запуск после него оплатил бы синтез
 *     дважды.
 *
 * Функция чистая: ни БД, ни Nitro. Всё, что ей нужно, приходит аргументом —
 * поэтому денежные правила проверяются тестом, а не глазами.
 */

import type { AlignScene } from "../transcription/align"
import { mergeScriptLines } from "./script-merge"
import { buildTrackRequest } from "./track-builder"
import { AWAITING_OPERATOR_STATUS } from "../video-pipeline-stepwise"

/**
 * Статусы, в которых полную перегенерацию имеет смысл начинать.
 *
 * Тот же список, что у замены фразы (`REPLACEABLE_VIDEO_STATUSES`), и по той же
 * причине: ролик либо досмотрен, либо остановился. `awaiting_operator` входит —
 * это остановленный ролик, прогона за ним нет.
 */
const REGENERABLE_VIDEO_STATUSES = [
  "completed",
  "failed",
  "canceled",
  AWAITING_OPERATOR_STATUS,
] as const

/** Статусы шага, означающие «перегенерация уже идёт». */
const STEP_IN_FLIGHT_STATUSES = ["pending", "queued", "running"] as const

export interface TrackRegenerationPreview {
  /** Сколько сцен уйдёт в новый трек. */
  sceneCount: number
  /** Символов на синтез — по ним считается цена TTS. */
  characters: number
  /** Сцены, чей текст разошёлся с треком. Пусто — трек уже соответствует сценарию. */
  changedSceneOrders: number[]
  /** Голос или модель ролика поменялись после синтеза трека. */
  voiceChanged: boolean
  /** Кадры, которые придётся собрать заново: обесцениваются ВСЕ. */
  shotsToRebuild: number
  /**
   * Секунды губ, за которые придётся заплатить второй раз.
   *
   * Берётся длительность всего трека — это ВЕРХНЯЯ оценка: платится лип-синк
   * только за сцены с ведущим в кадре. Занижать цену в окне подтверждения
   * нельзя, поэтому округляем в худшую для кошелька сторону.
   */
  lipSyncSecondsToRepay: number
  /** Во что обойдётся перегенерация: синтез плюс повторный lip-sync. */
  estimatedCostUsd: number
}

export type TrackRegenerationPlan =
  /** Можно перегенерировать: сценарий разошёлся с треком, сумма подтверждена. */
  | { kind: "run", videoId: number, preview: TrackRegenerationPreview }
  /** Нужна явная подпись под суммой. */
  | { kind: "confirm", statusCode: 400, message: string, preview: TrackRegenerationPreview }
  /** Делать нечего, и это не ошибка: платить второй раз не за что. */
  | { kind: "noop", videoId: number, reason: string, preview: TrackRegenerationPreview }
  /** Ролика нет, он занят или ему эта операция не подходит. */
  | { kind: "refuse", statusCode: number, message: string }

export interface TrackRegenerationInput {
  id: number
  body: { confirmExpensive?: unknown, force?: unknown } | null | undefined
  video: {
    status: string
    isLocked: boolean
    /** Закадровый нарратор ролика. Реплики ведущего в кадре от него не зависят. */
    voiceoverEnabled: boolean
    voiceoverVoiceId: string | null
    voiceoverModelId: string | null
  } | null
  voiceoverStep: { status: string, snapshot: Record<string, unknown> | null } | null
  /** Сценарий ролика (`ScenarioVariant.storyPlan`) — источник текста трека. */
  storyPlan: unknown
  /** Сколько кадров стоит на этом треке: их придётся собрать заново. */
  shotsToRebuild: number
  /** Цены в тех же единицах, что `ModelMeta.pricing` (`video-models.ts`). */
  pricing: { ttsUnit: string, ttsBase: number, lipSyncUsdPerSecond: number }
}

const EMPTY_PREVIEW: TrackRegenerationPreview = {
  sceneCount: 0,
  characters: 0,
  changedSceneOrders: [],
  voiceChanged: false,
  shotsToRebuild: 0,
  lipSyncSecondsToRepay: 0,
  estimatedCostUsd: 0,
}

/** Сцены сценария и закадровые строки в том виде, в каком их читает шаг озвучки. */
function readStoryPlan(storyPlan: unknown, voiceoverEnabled: boolean): {
  scenes: Array<{ order: number, spokenLine: string | null }>
  voiceoverLines: Array<{ sceneOrder: number, text: string }>
} | null {
  const plan = storyPlan as Record<string, unknown> | null | undefined
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null
  if (!Array.isArray(plan.scenes)) return null

  const scenes = (plan.scenes as Array<Record<string, unknown>>).map(scene => ({
    order: Number(scene.order),
    spokenLine: typeof scene.spokenLine === "string" ? scene.spokenLine : null,
  }))

  const voiceoverPlan = (plan.voiceoverPlan ?? null) as Record<string, unknown> | null
  // Правило один в один как в `runAudioFirstVoiceover`: нарратор идёт в трек,
  // только если включён И планом, И настройкой ролика.
  const narrationEnabled = voiceoverEnabled && voiceoverPlan?.enabled === true
  const voiceoverLines = narrationEnabled && Array.isArray(voiceoverPlan?.lines)
    ? (voiceoverPlan!.lines as Array<Record<string, unknown>>)
      .map(line => ({ sceneOrder: Number(line.sceneOrder), text: typeof line.text === "string" ? line.text : "" }))
      .filter(line => line.text.trim().length > 0)
    : []

  return { scenes, voiceoverLines }
}

/** Сцены, чей текст в новом треке будет иным, чем в нынешнем. */
function diffSceneTexts(current: readonly AlignScene[], next: readonly AlignScene[]): number[] {
  const before = new Map(current.map(scene => [scene.order, scene.text]))
  const after = new Map(next.map(scene => [scene.order, scene.text]))
  const changed = new Set<number>()

  for (const [order, text] of after) {
    if (before.get(order) !== text) changed.add(order)
  }
  // Сцена, которая была в треке и исчезла из сценария, — тоже расхождение:
  // её звук из трека уйдёт, и её кадр придётся пересобрать.
  for (const order of before.keys()) {
    if (!after.has(order)) changed.add(order)
  }

  return [...changed].sort((a, b) => a - b)
}

export function planTrackRegeneration(input: TrackRegenerationInput): TrackRegenerationPlan {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    return { kind: "refuse", statusCode: 400, message: "Некорректный ID видео" }
  }
  if (!input.video) {
    return { kind: "refuse", statusCode: 404, message: "Видео не найдено" }
  }
  if (input.video.isLocked) {
    return { kind: "refuse", statusCode: 409, message: "Видео заблокировано — идёт другая операция" }
  }
  if (!REGENERABLE_VIDEO_STATUSES.includes(input.video.status as typeof REGENERABLE_VIDEO_STATUSES[number])) {
    return {
      kind: "refuse",
      statusCode: 400,
      message: `Перегенерация трека недоступна в статусе '${input.video.status}'`,
    }
  }

  // Проверка «уже идёт» стоит ДО проверки маршрута намеренно: у сброшенного
  // шага снапшота нет вовсе, и гейт маршрута соврал бы оператору «ролик не
  // собирали от звука» ровно тогда, когда трек как раз синтезируется.
  const stepStatus = input.voiceoverStep?.status ?? ""
  if (STEP_IN_FLIGHT_STATUSES.includes(stepStatus as typeof STEP_IN_FLIGHT_STATUSES[number])) {
    return {
      kind: "noop",
      videoId: input.id,
      reason: `Перегенерация трека уже запущена (шаг озвучки в статусе '${stepStatus}') — второй раз платить не за что`,
      preview: { ...EMPTY_PREVIEW, shotsToRebuild: input.shotsToRebuild },
    }
  }

  const snapshot = input.voiceoverStep?.snapshot ?? null
  if (!snapshot || snapshot.route !== "audio_first" || typeof snapshot.trackPath !== "string") {
    return {
      kind: "refuse",
      statusCode: 400,
      message: "Видео не собирали от звука — единого трека нет, "
        + "перегенерация трека работает только на маршруте «монтаж от звука»",
    }
  }

  const story = readStoryPlan(input.storyPlan, input.video.voiceoverEnabled)
  if (!story) {
    return {
      kind: "refuse",
      statusCode: 400,
      message: "У видео нет сценария (storyPlan) — собирать новый трек не из чего",
    }
  }

  let nextScenes: AlignScene[]
  let text: string
  try {
    // Тот же сборщик, что и у боевого шага: иначе «что получится» и «что
    // получилось» разойдутся, и сравнение с треком станет выдумкой.
    const request = buildTrackRequest(mergeScriptLines({
      scenes: story.scenes,
      voiceoverLines: story.voiceoverLines,
    }))
    nextScenes = request.scenes
    text = request.text
  }
  catch (err) {
    return {
      kind: "refuse",
      statusCode: 400,
      message: `Новый трек собрать нельзя: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const currentScenes = Array.isArray(snapshot.scenes) ? (snapshot.scenes as AlignScene[]) : []
  const changedSceneOrders = diffSceneTexts(currentScenes, nextScenes)
  // Голос и модель сравниваем с тем, чем трек РЕАЛЬНО спет (снапшот), а не с
  // тем, что стояло в ролике когда-то: клон голоса живёт в своей модели, и
  // сменивший голос ролик обязан получить право на пересинтез.
  const voiceChanged = (snapshot.voiceId ?? null) !== input.video.voiceoverVoiceId
    || (snapshot.modelId ?? null) !== input.video.voiceoverModelId

  const trackDurationSec = typeof snapshot.durationSec === "number" && snapshot.durationSec > 0
    ? snapshot.durationSec
    : 0
  const ttsCost = input.pricing.ttsUnit === "character"
    ? text.length * input.pricing.ttsBase
    : trackDurationSec * input.pricing.ttsBase
  const preview: TrackRegenerationPreview = {
    sceneCount: nextScenes.length,
    characters: text.length,
    changedSceneOrders,
    voiceChanged,
    shotsToRebuild: input.shotsToRebuild,
    lipSyncSecondsToRepay: trackDurationSec,
    estimatedCostUsd: ttsCost + trackDurationSec * input.pricing.lipSyncUsdPerSecond,
  }

  const force = input.body?.force === true
  const confirmed = input.body?.confirmExpensive === true

  // Подпись под суммой спрашиваем ДО проверки «а надо ли»: иначе `force`
  // проскакивал бы к перегенерации вообще без подтверждения — то есть самый
  // дорогой путь оказался бы самым коротким.
  if (!confirmed) {
    return {
      kind: "confirm",
      statusCode: 400,
      message: `Полная перегенерация трека обесценит все аватарные кадры ролика: `
        + `собрать заново придётся ${preview.shotsToRebuild} кадров, `
        + `ориентировочная стоимость до $${preview.estimatedCostUsd.toFixed(2)}. `
        + `Повторите запрос с 'confirmExpensive: true'. `
        + `Правка одной фразы дешевле в разы — POST /voiceover/replace-segment.`,
      preview,
    }
  }

  if (changedSceneOrders.length === 0 && !voiceChanged && !force) {
    return {
      kind: "noop",
      videoId: input.id,
      reason: "Трек уже соответствует сценарию и голосу ролика — пересинтезировать нечего. "
        + "Принудительный пересинтез — 'force: true'.",
      preview,
    }
  }

  return { kind: "run", videoId: input.id, preview }
}
