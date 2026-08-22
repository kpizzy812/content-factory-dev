/**
 * Детерминированный ремонт плана кадров.
 *
 * §5.3: нарушения сначала чинятся притяжкой границ к ближайшему межсловному
 * интервалу, и только если после ремонта план всё ещё невалиден — идёт повторный
 * запрос к модели с текстом ошибки. Порядок именно такой, потому что второй
 * запрос стоит денег и времени, а девять из десяти нарушений — это границы,
 * которые код умеет поправить сам.
 *
 * Функция чистая и не мутирует вход: план приходит из ответа модели, и портить
 * его значит потерять то, что уйдёт в диагностику при повторном запросе.
 *
 * Фикс-раунд 1 (ревью task-3-review.md, 3 Critical + 4 Important):
 * - конец таймлайна и допуск округления берутся из `validate.ts`
 *   (`timelineEndSec`/`halfFrameSec`), а не считаются заново — расхождение
 *   между ремонтом и валидацией на некратной кадру длительности трека давало
 *   ложную дыру в хвосте на 49.2% случаев (Critical 2);
 * - притяжка к щели ограничена окном и не трогает уже исправные границы, а не
 *   тащит их через весь ролик (Important 1);
 * - кадры короче {@link MIN_SHOT_SEC} сливаются со следующим, а не остаются
 *   миганием в один кадр — раньше цепочка узких щелей превращала одно
 *   нарушение в две-три дюжины (Critical 1);
 * - конец последнего кадра зажимается снизу собственным началом — раньше это
 *   был единственный незажатый край, и он мог дать нулевую/отрицательную
 *   длину (Critical 3, вместе с новым кодом `invalid_bounds` в `validate.ts`);
 * - тишина до первого и после последнего слова тоже считается щелью
 *   (Important 4) — раньше `collectGaps` их не видела;
 * - возвращает `before`/`remaining` вместо не соответствующего своему имени
 *   `repaired` (Important 3): `remaining` — это ЧЕСТНЫЙ повторный прогон
 *   валидации по факту ремонта, а не список нарушений ДО него.
 */

import { snapSecToFrame } from "../voiceover/segment-cut"
import { halfFrameSec, splitsWord, timelineEndSec, validateShotPlan } from "./validate"
import type { PlannedShot, ShotPlan } from "./types"
import type { ShotPlanContext, ShotPlanViolation } from "./validate"

/** Межсловные интервалы: пары (конец слова, начало следующего) плюс тишина по краям. */
interface WordGap {
  startSec: number
  endSec: number
}

/**
 * Минимальная длина кадра, которую ремонт готов оставить в плане. Меньше —
 * это не смена плана, а мигание (Critical 1 ревью: цепочка близко идущих щелей
 * без пространства между ними давала кадры по 33 мс). Такой кадр сливается со
 * следующим, а не попадает в план. Ориентир — тот же порог, что
 * `MIN_VALID_SHOT_CHANGE_SEC` в `profile.ts` для ВАЛИДНОСТИ шага монтажа
 * («короче — смена картинки читается как мигание, а не монтаж»); здесь речь о
 * ФАКТИЧЕСКОЙ длине уже нарезанного кадра, поэтому константа своя, но того же
 * порядка величины.
 */
export const MIN_SHOT_SEC = 0.8

/**
 * Насколько далеко от желаемой точки реза имеет смысл искать безопасную щель.
 * Дальше — это уже не починка границы, а самовольная пересборка монтажного
 * ритма (Important 1 ревью: наблюдался перенос границы на 1.9 с при целевом
 * шаге монтажа 1.5-2 с). Если подходящей щели нет в пределах окна — граница
 * остаётся на месте, рвёт слово, и это уходит в `remaining`: резать по слову с
 * честной пометкой лучше, чем уносить кадр на другой конец ролика.
 */
const SAFE_POINT_WINDOW_SEC = 1.0

function collectGaps(context: ShotPlanContext): WordGap[] {
  const words = context.alignedScenes
    .flatMap(scene => scene.words)
    .slice()
    .sort((a, b) => a.startSec - b.startSec)

  if (words.length === 0) return []

  const gaps: WordGap[] = []
  const timelineEnd = timelineEndSec(context.trackDurationSec, context.fps)

  // Тишина до первого слова и после последнего — тоже щель (Important 4
  // ревью): это самые естественные точки реза, а прежняя реализация видела
  // только пары СОСЕДНИХ слов и на разреженном материале теряла две самые
  // широкие щели трека.
  if (words[0]!.startSec > 0) gaps.push({ startSec: 0, endSec: words[0]!.startSec })

  for (let index = 0; index + 1 < words.length; index += 1) {
    const end = words[index]!.endSec
    const next = words[index + 1]!.startSec
    if (next > end) gaps.push({ startSec: end, endSec: next })
  }

  const lastWordEnd = words[words.length - 1]!.endSec
  if (lastWordEnd < timelineEnd) gaps.push({ startSec: lastWordEnd, endSec: timelineEnd })

  return gaps
}

/**
 * Безопасная точка реза рядом с желаемой границей.
 *
 * Если желаемая граница УЖЕ не рвёт слово — она остаётся на месте (только
 * притягивается к кадру): переписывать исправную границу незачем, а
 * безусловный поиск ближайшей щели двигал бы её даже там, где чинить нечего
 * (Important 1 ревью, второй симптом — «ремонт переписывает все границы, а не
 * только нарушенные»). Если рвёт — ищем ближайшую щель, но только в пределах
 * {@link SAFE_POINT_WINDOW_SEC}: щели дальше окна не побеждают, даже если
 * ничего ближе не нашлось — тогда граница остаётся на желаемой точке,
 * притянутой к кадру, всё ещё рвёт слово, и об этом честно узнает `remaining`.
 */
function resolveBoundary(
  words: readonly { startSec: number, endSec: number }[],
  gaps: readonly WordGap[],
  desiredSec: number,
  fps: number,
): number {
  if (!splitsWord(words, desiredSec)) return snapSecToFrame(desiredSec, fps)

  let best: WordGap | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const middle = (gap.startSec + gap.endSec) / 2
    const distance = Math.abs(middle - desiredSec)
    if (distance <= SAFE_POINT_WINDOW_SEC && distance < bestDistance) {
      bestDistance = distance
      best = gap
    }
  }
  return snapSecToFrame(best ? (best.startSec + best.endSec) / 2 : desiredSec, fps)
}

export interface ShotPlanRepairResult {
  plan: ShotPlan
  /** Нарушения ДО ремонта — что было не так и заставило чинить план. */
  before: ShotPlanViolation[]
  /**
   * Нарушения ПОСЛЕ ремонта — то, что детерминированно починить не удалось
   * (например `word_split` без щели в окне, `presenter_too_long`,
   * `broll_ratio` — они не про геометрию границ). Именно этот список решает,
   * идти ли на повторный запрос к модели (§5.3), а не `before`: `before`
   * содержит и то, что ремонт заведомо не трогает, и молчит о правках,
   * сделанных не по нарушению (перенумерация, деградация фона) — выдавать его
   * за «что почищено» неверно (Important 3 ревью).
   */
  remaining: ShotPlanViolation[]
}

export function repairShotPlan(context: ShotPlanContext): ShotPlanRepairResult {
  const before = validateShotPlan(context)
  const { fps, trackDurationSec } = context

  const original: PlannedShot[] = context.plan.shots
    .map(shot => ({ ...shot }))
    .sort((a, b) => a.startSec - b.startSec)

  if (original.length === 0) {
    const emptyPlan: ShotPlan = { shots: [] }
    return { plan: emptyPlan, before, remaining: validateShotPlan({ ...context, plan: emptyPlan }) }
  }

  const gaps = collectGaps(context)
  const words = context.alignedScenes.flatMap(scene => scene.words)

  // 1a. "Сырые" границы: конец последнего — конец таймлайна, остальные —
  //     безопасная точка рядом с желаемым концом исходного кадра. Нефинитную
  //     исходную границу (кадр от модели с NaN/`undefined`, Critical 3
  //     ревью) заменяем на начало кадра, а если и оно нечисловое — на 0:
  //     дальше её всё равно перезапишет либо снап к кадру, либо слияние на
  //     шаге 1b, а не протащит NaN в план.
  const rawEnds: number[] = original.map((shot, index) => {
    if (index === original.length - 1) return timelineEndSec(trackDurationSec, fps)

    const originalEnd = Number.isFinite(shot.endSec) ? shot.endSec : shot.startSec
    const safeOriginalEnd = Number.isFinite(originalEnd) ? originalEnd : 0
    const desiredEnd = Math.min(safeOriginalEnd, trackDurationSec)
    return resolveBoundary(words, gaps, desiredEnd, fps)
  })

  // 1b. Слияние кадров короче MIN_SHOT_SEC со следующим (Critical 1 ревью).
  //     Кадр, чья "сырая" граница не даёт ему минимальной длины, не попадает
  //     в план вовсе: его место и метаданные наследует кадр, который замкнёт
  //     цепочку слияния. Один длинный кадр честнее дюжины миганий. Последний
  //     кадр попадает в план всегда, даже если весь остаток короче минимума —
  //     дальше сливать уже не с чем.
  const merged: PlannedShot[] = []
  let pendingStart = 0
  for (let index = 0; index < original.length; index += 1) {
    const end = rawEnds[index]!
    const isLast = index === original.length - 1
    if (!isLast && end - pendingStart < MIN_SHOT_SEC) continue
    merged.push({ ...original[index]!, startSec: pendingStart, endSec: end })
    pendingStart = end
  }

  // 2. Источники, которые нельзя оставить: несуществующий фон (библиотека БЕЗ
  //    известного клипа или app_screen без ссылки — Minor 5 ревью) и
  //    генеративное видео, которое либо короче минимума, либо запрещено
  //    флагом профиля (Minor 6 ревью; было — только длина). Порог короткого
  //    видео здесь тот же допуск округления, что в validate.ts (Minor 3
  //    ревью: раньше `repair` сравнивал без эпсилона вовсе).
  //
  //    Не чинятся здесь `presenter_too_long` (это дробление длинной реплики,
  //    отдельный детерминированный шаг `splitLongPresenterLine` из Task 4,
  //    §5.3 — раннер Task 5 вызывает его до этой функции) и `broll_ratio`
  //    (доля перебивок — вопрос СМЫСЛА подбора кадров, а не арифметики границ;
  //    Minor 9 ревью).
  const eps = halfFrameSec(fps)
  for (const shot of merged) {
    const missingLibraryRef = shot.background === "library"
      && (!shot.backgroundClipId || !context.knownBackgroundIds.has(shot.backgroundClipId))
    const missingAppScreenRef = shot.background === "app_screen" && !shot.appReferenceId

    if (missingLibraryRef || missingAppScreenRef) {
      shot.background = shot.foreground === "presenter" ? "none" : "image"
      shot.backgroundClipId = null
    }
    if (shot.background === "video") {
      const tooShort = shot.endSec - shot.startSec < context.minGenerativeVideoSec - eps
      const disabled = !context.profile.generativeVideoEnabled
      if (tooShort || disabled) shot.background = "image"
    }
  }

  // 3. Нумерация подряд с нуля: order — ключ (videoId, order) в БД и позиция в
  //    склейке; дырки в нём означают потерянный кадр.
  merged.forEach((shot, index) => { shot.order = index })

  const plan: ShotPlan = { shots: merged }
  const remaining = validateShotPlan({ ...context, plan })
  return { plan, before, remaining }
}
