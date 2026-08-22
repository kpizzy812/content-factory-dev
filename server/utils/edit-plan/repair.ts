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
 * Фикс-раунд 1 (ревью task-3-review.md, 3 Critical + 4 Important): общий с
 * `validate.ts` конец таймлайна и допуск округления; окно поиска щели; слияние
 * коротких кадров вместо мигания; код `invalid_bounds`; тишина по краям трека
 * тоже щель; честные `before`/`remaining`.
 *
 * Фикс-раунд 2 (ре-ревью task-3-rereview.md, 3 Critical + 4 Important):
 * слияние из раунда 1 лечило симптом, но само порождало нарушения:
 * - Critical Н-1: слияние могло растянуть presenter-кадр за потолок lip-sync
 *   ИЛИ съесть все presenter-кадры целиком (перекос доли перебивок к 100%).
 *   Оба нарушения ремонт не умеет чинить сам, то есть гарантировал платный
 *   повторный запрос — ровно то, ради чего §5.3 существует. Теперь слияние
 *   проверяется {@link canMergeSafely}: сначала пробуем слить со следующим,
 *   нельзя — с предыдущим, нельзя ни с кем — короткий кадр остаётся как есть.
 * - Critical Н-2: внутренняя граница клэмпилась СЫРОЙ `trackDurationSec`, а не
 *   `timelineEndSec` — на планах с кадром за концом трека `snapSecToFrame`
 *   уводил границу выше настоящего конца, давая вырожденный (нулевой или
 *   отрицательный) кадр в 100% таких случаев. Теперь клэмп — `timelineEndSec`.
 * - Critical Н-3: хвост был явно исключён из слияния (`!isLast`) — короткий
 *   финальный кадр проходил чистым. Теперь хвост участвует в слиянии наравне
 *   с остальными (сливается НАЗАД, в предыдущий — вперёд для него нет цели).
 * - Important Н-4: расстояние до щели мерялось до её СЕРЕДИНЫ, из-за чего
 *   широкие щели (в том числе только что добавленная краевая тишина)
 *   систематически отвергались окном поиска. Теперь — до ближайшей безопасной
 *   точки ВНУТРИ щели (`clamp` с запасом на слово и кадр).
 * - Important Н-5: константы слияния и окна поиска были фиксированы и могли
 *   конфликтовать с легальной настройкой `profile.shotChangeSec` (например,
 *   `shotChangeSec = 0.8` — легальный минимум по `profile.ts` — совпадал со
 *   старым порогом слияния и вырезал половину плана). Теперь обе величины —
 *   доля от `profile.shotChangeSec`.
 * - Important Н-6: слияние удаляло кадр вместе с `idea`/`sceneOrder`/
 *   `backgroundClipId` молча. Теперь `repairShotPlan` возвращает `changes` —
 *   список того, что реально сделано (слито, сброшено, деградировано).
 * - Minor Н-8..Н-11: докстринг `remaining` был неточным (см. поле ниже);
 *   `collectGaps` могла отдать щель ВНУТРИ слова при перекрывающихся словах,
 *   выбранная точка теперь перепроверяется; `WORD_EDGE_TOLERANCE_SEC` стал
 *   зависеть от fps вместе с допуском округления (перенесено в `validate.ts`);
 *   проверка ссылки на фон в `validate.ts` приведена к тому же стилю (`||`),
 *   что уже был здесь.
 */

import { snapSecToFrame } from "../voiceover/segment-cut"
import { halfFrameSec, splitsWord, timelineEndSec, validateShotPlan } from "./validate"
import type { PlannedShot, ShotPlan } from "./types"
import type { ResolvedEditProfile } from "./profile"
import type { ShotPlanContext, ShotPlanViolation } from "./validate"

/** Межсловные интервалы: пары (конец слова, начало следующего) плюс тишина по краям. */
interface WordGap {
  startSec: number
  endSec: number
}

/** Отрезок таймлайна на промежуточном шаге ремонта — до материализации в `PlannedShot`. */
interface Segment {
  startSec: number
  endSec: number
  /** Чьи метаданные (foreground/background/idea/...) сейчас несёт отрезок. */
  source: PlannedShot
}

/**
 * Доля целевого шага монтажа, которую кадр обязан набрать, чтобы не считаться
 * миганием (Important Н-5 ре-ревью). Раньше был константой 0.8 с, СЛУЧАЙНО
 * совпадавшей с `MIN_VALID_SHOT_CHANGE_SEC` — нижней границей ЛЕГАЛЬНОЙ
 * настройки `profile.shotChangeSec` (`profile.ts`). При такой настройке пол
 * ремонта равнялся цели, и ремонт вырезал примерно половину плана. Доля 0.4
 * держит пол заметно ниже цели на всём легальном диапазоне: при минимуме
 * 0.8 с пол — 0.32 с, при дефолте 1.8 с — 0.72 с.
 */
const MIN_SHOT_RATIO = 0.4

/**
 * Доля целевого шага монтажа, задающая окно поиска безопасной точки реза
 * (Important Н-5 ре-ревью). Раньше окно было константой 1.0 с — шире целого
 * кадра при легальном минимальном шаге 0.8 с и 56% кадра при дефолтном 1.8 с
 * (замер ре-ревью: граница уехала ровно на всю ширину окна и утащила с собой
 * соседний кадр). Доля 0.3 заметно уже половины шага на всём диапазоне.
 */
const SAFE_POINT_WINDOW_RATIO = 0.3

/** Экспортируется, чтобы тесты считали ожидаемый порог от того же профиля, а не дублировали формулу магическим числом. */
export function minShotSec(profile: ResolvedEditProfile): number {
  return profile.shotChangeSec * MIN_SHOT_RATIO
}

/** Экспортируется по той же причине, что {@link minShotSec}. */
export function safePointWindowSec(profile: ResolvedEditProfile): number {
  return profile.shotChangeSec * SAFE_POINT_WINDOW_RATIO
}

function collectGaps(context: ShotPlanContext, timelineEnd: number): WordGap[] {
  const words = context.alignedScenes
    .flatMap(scene => scene.words)
    .slice()
    .sort((a, b) => a.startSec - b.startSec)

  if (words.length === 0) return []

  const gaps: WordGap[] = []

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
 * Точка ВНУТРИ щели, ближайшая к желаемой границе, с запасом `margin` от
 * обоих краёв щели: край щели совпадает с концом/началом слова, и точка без
 * запаса сдвинула бы кадр вплотную к слову — притяжка к кадру (округление до
 * `snapSecToFrame`) могла бы тогда снова завести её внутрь слова. Если щель
 * уже удвоенного запаса — целимся в её середину, деваться некуда.
 */
function nearestPointInGap(gap: WordGap, desiredSec: number, margin: number): number {
  const lo = gap.startSec + margin
  const hi = gap.endSec - margin
  if (lo > hi) return (gap.startSec + gap.endSec) / 2
  return Math.min(Math.max(desiredSec, lo), hi)
}

/**
 * Безопасная точка реза рядом с желаемой границей.
 *
 * Если желаемая граница УЖЕ не рвёт слово — она остаётся на месте (только
 * притягивается к кадру): переписывать исправную границу незачем (Important 1
 * ревью). НО округление к кадру само способно столкнуть безопасную точку
 * обратно внутрь слова, если запас был меньше половины кадра (найдено
 * тестом-свойством при увеличении числа сценариев с 80 до 300: `desiredSec`
 * лежал в 3.7 мс от границы допуска, что меньше половины кадра на 25 fps
 * (20 мс), и `snapSecToFrame` перекинул точку на другую сторону) — поэтому
 * притянутая к кадру точка ПЕРЕПРОВЕРЯЕТСЯ, и если снятие всё же порвало
 * слово, граница обрабатывается наравне со случаем «рвёт с самого начала».
 * Тогда ищем ближайшую щель В ПРЕДЕЛАХ `windowSec`, но расстояние меряем до
 * БЛИЖАЙШЕЙ БЕЗОПАСНОЙ ТОЧКИ ВНУТРИ щели ({@link nearestPointInGap}), а не до
 * её середины (Important Н-4 ре-ревью): середина широкой щели может быть
 * дальше окна, хотя её ближний край — рядом, и именно так систематически
 * отвергались самые удобные щели, включая только что добавленную краевую
 * тишину. Выбранная точка тоже перепроверяется на то, что сама не рвёт слово
 * (Minor Н-9 ре-ревью: при перекрывающихся словах щель между несмежными
 * парами может лежать ВНУТРИ третьего слова). Если ничего не подошло —
 * граница остаётся на желаемой точке, притянутой к кадру, всё ещё рвёт слово,
 * и об этом честно узнает `remaining`.
 */
function resolveBoundary(
  words: readonly { startSec: number, endSec: number }[],
  gaps: readonly WordGap[],
  desiredSec: number,
  fps: number,
  windowSec: number,
  timelineEnd: number,
): number {
  if (!splitsWord(words, desiredSec, fps)) {
    const snapped = snapSecToFrame(desiredSec, fps)
    if (!splitsWord(words, snapped, fps)) return snapped
  }

  const margin = halfFrameSec(fps) * 2

  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const point = nearestPointInGap(gap, desiredSec, margin)
    if (splitsWord(words, point, fps)) continue
    const distance = Math.abs(point - desiredSec)
    if (distance <= windowSec && distance < bestDistance) {
      bestDistance = distance
      best = point
    }
  }
  // Math.min с timelineEnd — защита по построению: щель приходит из
  // collectGaps и не должна вылезать за конец таймлайна, но граница обязана
  // держать инвариант «не позже конца трека» без исключений (Critical 2/Н-2).
  return snapSecToFrame(Math.min(best ?? desiredSec, timelineEnd), fps)
}

/**
 * Может ли `eaten` быть слит в `survivor` БЕЗ нарушения, которое ремонт не
 * умеет чинить сам (Critical Н-1 ре-ревью). Два жёстких предела:
 * - потолок lip-sync модели, если слитый кадр остаётся presenter-кадром;
 * - presenter-кадр не может быть съеден НЕ-presenter соседом: это не смещение
 *   доли перебивок (она уже не блокирует §5.3 по рулингу заказчика), а полная
 *   потеря ведущего из ролика, если так съедены ВСЕ presenter-кадры подряд.
 *   Обратное (не-presenter съедается presenter-соседом) разрешено: ведущий
 *   поглощает перебивку, но сам не исчезает.
 *
 * Геометрическая сломанность `eaten` (нулевая/отрицательная длина) здесь
 * НЕ считается пропуском проверок — раньше считалась, и ровно это давало
 * `presenter_too_long`: вырожденный кадр, поглощённый presenter-соседом БЕЗ
 * проверки потолка, мог протолкнуть его за предел (найдено тестом-свойством
 * #30, а не примером). Вырожденность обрабатывает вызывающая сторона
 * ({@link mergeShortSegments}) отдельным принудительным шагом, когда оба
 * безопасных направления отклонены.
 */
function canMergeSafely(eaten: Segment, survivor: Segment, lipSyncMaxDurationSec: number, eps: number): boolean {
  if (eaten.source.foreground === "presenter" && survivor.source.foreground !== "presenter") return false

  if (survivor.source.foreground === "presenter") {
    const mergedStart = Math.min(eaten.startSec, survivor.startSec)
    const mergedEnd = Math.max(eaten.endSec, survivor.endSec)
    if (mergedEnd - mergedStart > lipSyncMaxDurationSec + eps) return false
  }

  return true
}

export interface ShotPlanRepairAction {
  /** Кадр(ы), которых касается правка (по исходному, ещё не перенумерованному order). */
  shotOrder: number | null
  message: string
}

/** Слить `eaten` в `survivor` по направлению `forward`/`backward`, записав диагностику. */
function applyMerge(
  list: Segment[],
  index: number,
  direction: "forward" | "backward",
  actions: ShotPlanRepairAction[],
  reason: string,
): void {
  const seg = list[index]!
  const survivorIndex = direction === "forward" ? index + 1 : index - 1
  const survivor = list[survivorIndex]!
  actions.push({
    shotOrder: seg.source.order,
    message: `Кадр ${seg.source.order} (${(seg.endSec - seg.startSec).toFixed(2)}с) слит с ${direction === "forward" ? "следующим" : "предыдущим"} кадром ${survivor.source.order} — ${reason}`,
  })
  if (direction === "forward") {
    list[survivorIndex] = { ...survivor, startSec: seg.startSec }
  } else {
    list[survivorIndex] = { ...survivor, endSec: seg.endSec }
  }
  list.splice(index, 1)
}

/**
 * Слияние коротких и геометрически сломанных кадров.
 *
 * Два прохода за итерацию, в порядке убывания приоритета безопасности
 * (Critical Н-1 ре-ревью, найдено тестом-свойством #30 — не примером):
 *
 * 1. БЕЗОПАСНОЕ слияние — {@link canMergeSafely} — пробуем со следующим,
 *    нельзя — с предыдущим. Покрывает и короткие, и вырожденные кадры: для
 *    вырожденного (нулевая/отрицательная длина) слияние в любом безопасном
 *    направлении устраняет проблему, ничего не нарушая.
 * 2. Если безопасное слияние отклонено ОБОИМИ соседями (или соседа нет):
 *    - кадр просто короткий (длина положительна) — оставляем как есть.
 *      Хуже нормального кадра, но лучше неустранимого нарушения и платного
 *      повторного запроса (рулинг заказчика);
 *    - кадр геометрически сломан (длина <= 0) — оставить нельзя вообще:
 *      `invalid_bounds`/`out_of_track` были ровно тем, от чего фикс-раунд 1
 *      уже отказался (Critical 2/3). Сливаем ПРИНУДИТЕЛЬНО, куда можем
 *      (вперёд приоритетнее), даже если это создаёт `presenter_too_long` —
 *      между гарантированно невалидной геометрией и потенциальным жёстким
 *      пределом выбирается меньшее зло. Это тупиковый путь: на реальных
 *      входах ffprobe-трек всегда положительной длины, а слова не выходят за
 *      его пределы, так что вырожденный кадр без единого безопасного соседа
 *      требует одновременного схождения нескольких патологий.
 *
 * Фиксированная точка достигается за конечное число шагов: список строго
 * укорачивается на каждом успешном слиянии.
 */
function mergeShortSegments(
  initial: readonly Segment[],
  context: ShotPlanContext,
): { segments: Segment[], actions: ShotPlanRepairAction[] } {
  const list = initial.slice()
  const actions: ShotPlanRepairAction[] = []
  const eps = halfFrameSec(context.fps)
  const threshold = minShotSec(context.profile)

  let changed = true
  while (changed) {
    changed = false
    for (let index = 0; index < list.length; index += 1) {
      if (list.length === 1) break
      const seg = list[index]!
      const length = seg.endSec - seg.startSec
      const degenerate = length <= 0
      if (!degenerate && length >= threshold) continue

      const hasNext = index < list.length - 1
      const hasPrev = index > 0

      if (hasNext && canMergeSafely(seg, list[index + 1]!, context.lipSyncMaxDurationSec, eps)) {
        applyMerge(list, index, "forward", actions, "короче минимума монтажного шага")
        changed = true
        break
      }
      if (hasPrev && canMergeSafely(seg, list[index - 1]!, context.lipSyncMaxDurationSec, eps)) {
        applyMerge(list, index, "backward", actions, "короче минимума монтажного шага")
        changed = true
        break
      }
      if (!degenerate) continue // короткий, но геометрически здоровый — оставляем как есть

      if (hasNext) {
        applyMerge(list, index, "forward", actions, "нулевая или отрицательная длина, безопасного слияния нет")
        changed = true
        break
      }
      if (hasPrev) {
        applyMerge(list, index, "backward", actions, "нулевая или отрицательная длина, безопасного слияния нет")
        changed = true
        break
      }
      // Единственный кадр в плане: сливать не с кем. Остаётся вырожденным —
      // это фиксирует invalid_bounds в remaining, что честно и ожидаемо для
      // плана без реального материала (например trackDurationSec <= 0).
    }
  }
  return { segments: list, actions }
}

/**
 * Разгружает presenter-кадр на самом краю таймлайна, если он вырос за потолок
 * lip-sync из-за того, что первый/последний кадр по построению обязан
 * начинаться в 0 / заканчиваться в `timelineEnd` (Critical 2/3) — независимо
 * от того, сколько исходно "весил" сам кадр модели. Найдено тестом-свойством:
 * короткий presenter-кадр модели у самого края трека с большой непокрытой
 * дырой перед/после него молча наследует ВСЮ дыру, и это не проходит через
 * {@link mergeShortSegments} вовсе — там кадр к этому моменту уже длинный.
 *
 * Работает только когда сосед НЕ presenter: тогда общую границу можно сдвинуть
 * в его сторону — до кадра ровно под потолком, остаток отходит соседу без
 * ограничений (потолок есть только у presenter). Если сосед тоже presenter,
 * раздвинуть нечем: суммарная presenter-дистанция шире, чем два кадра под
 * потолком могут покрыть вместе — это не арифметика границ, а `splitLongPresenterLine`
 * (Task 4, §5.3), и конфликт остаётся как есть, честно попадая в `remaining`.
 */
function relieveOversizedPresenterEdge(
  segments: Segment[],
  edge: "first" | "last",
  lipSyncMaxDurationSec: number,
  eps: number,
  fps: number,
  words: readonly { startSec: number, endSec: number }[],
): void {
  if (segments.length < 2) return

  const index = edge === "first" ? 0 : segments.length - 1
  const neighborIndex = edge === "first" ? 1 : segments.length - 2
  const seg = segments[index]!
  const length = seg.endSec - seg.startSec
  if (seg.source.foreground !== "presenter" || length <= lipSyncMaxDurationSec + eps) return

  const neighbor = segments[neighborIndex]!
  const rawBoundary = edge === "first"
    ? seg.startSec + lipSyncMaxDurationSec
    : seg.endSec - lipSyncMaxDurationSec
  const boundary = snapSecToFrame(rawBoundary, fps)
  if (splitsWord(words, boundary, fps)) return

  if (edge === "first") {
    if (boundary <= seg.startSec + eps || boundary >= neighbor.endSec - eps) return
    if (neighbor.source.foreground === "presenter" && neighbor.endSec - boundary > lipSyncMaxDurationSec + eps) return
    seg.endSec = boundary
    neighbor.startSec = boundary
  } else {
    if (boundary >= seg.endSec - eps || boundary <= neighbor.startSec + eps) return
    if (neighbor.source.foreground === "presenter" && boundary - neighbor.startSec > lipSyncMaxDurationSec + eps) return
    seg.startSec = boundary
    neighbor.endSec = boundary
  }
}

export interface ShotPlanRepairResult {
  plan: ShotPlan
  /** Нарушения ДО ремонта — что было не так и заставило чинить план. */
  before: ShotPlanViolation[]
  /**
   * Нарушения ИТОГОВОГО плана — включая те, что мог создать сам ремонт
   * (Minor Н-8 ре-ревью: прежняя формулировка «то, что починить не удалось»
   * исключала именно этот случай, а он и оказался реальным — Critical
   * Н-1/Н-2/Н-3). Считается заново, повторным прогоном валидации по факту
   * ремонта. Именно этот список решает, идти ли на повторный запрос к модели
   * (§5.3), а не `before`: `before` содержит и то, что ремонт заведомо не
   * трогает (presenter_too_long, broll_ratio), и молчит о правках, сделанных
   * не по нарушению.
   */
  remaining: ShotPlanViolation[]
  /**
   * Что ремонт реально сделал: какие кадры слиты (с чьими метаданными и
   * почему), какие ссылки на фон сброшены, какое генеративное видео
   * деградировано до картинки (Important Н-6 ре-ревью). Слияние выбрасывает
   * метаданные съеденного кадра — библиотечную перебивку, `idea`, привязку к
   * сцене — без этого списка такая потеря была бы полностью бесшумной,
   * вопреки требованию §10 называть всякую деградацию.
   */
  changes: ShotPlanRepairAction[]
}

export function repairShotPlan(context: ShotPlanContext): ShotPlanRepairResult {
  const before = validateShotPlan(context)
  const { fps, trackDurationSec } = context

  const original: PlannedShot[] = context.plan.shots
    .map(shot => ({ ...shot }))
    .sort((a, b) => a.startSec - b.startSec)

  if (original.length === 0) {
    const emptyPlan: ShotPlan = { shots: [] }
    return { plan: emptyPlan, before, remaining: validateShotPlan({ ...context, plan: emptyPlan }), changes: [] }
  }

  const timelineEnd = timelineEndSec(trackDurationSec, fps)
  const gaps = collectGaps(context, timelineEnd)
  const words = context.alignedScenes.flatMap(scene => scene.words)
  const windowSec = safePointWindowSec(context.profile)

  // 1a. "Сырые" границы: конец последнего — конец таймлайна, остальные —
  //     безопасная точка рядом с желаемым концом исходного кадра. Клэмп
  //     желаемой точки — `timelineEnd`, а НЕ сырая `trackDurationSec`
  //     (Critical Н-2 ре-ревью): клэмп сырой длительностью пропускал точки
  //     ВЫШЕ фактического конца таймлайна дальше в `snapSecToFrame`, а то
  //     округление к ближайшему, а не к нижнему кадру — на планах с кадром
  //     за концом трека вырожденный (нулевой/отрицательный) кадр выходил в
  //     100% случаев. Нефинитную исходную границу (кадр от модели с
  //     NaN/`undefined`, Critical 3 ревью) заменяем на начало кадра, а если и
  //     оно нечисловое — на 0.
  const boundaries: number[] = new Array(original.length + 1)
  boundaries[0] = 0
  boundaries[original.length] = timelineEnd
  for (let index = 1; index < original.length; index += 1) {
    const shot = original[index - 1]!
    const originalEnd = Number.isFinite(shot.endSec) ? shot.endSec : shot.startSec
    const safeOriginalEnd = Number.isFinite(originalEnd) ? originalEnd : 0
    const desiredEnd = Math.min(safeOriginalEnd, timelineEnd)
    boundaries[index] = resolveBoundary(words, gaps, desiredEnd, fps, windowSec, timelineEnd)
  }

  const initialSegments: Segment[] = original.map((shot, index) => ({
    startSec: boundaries[index]!,
    endSec: boundaries[index + 1]!,
    source: shot,
  }))

  // 1a-bis. Первый и последний кадр по построению обязаны начинаться в 0 и
  //     заканчиваться в timelineEnd — иначе дыра по краям трека (Critical
  //     2/3). Побочный эффект: presenter-кадр модели с большой непокрытой
  //     дырой перед/после себя молча наследует её целиком и может выйти за
  //     потолок lip-sync ДО того, как до него дойдёт слияние коротких кадров
  //     (там он к этому моменту уже длинный, а не короткий). Разгружаем в
  //     сторону НЕ-presenter соседа, если он есть — см. докстринг
  //     {@link relieveOversizedPresenterEdge}.
  const eps = halfFrameSec(fps)
  relieveOversizedPresenterEdge(initialSegments, "first", context.lipSyncMaxDurationSec, eps, fps, words)
  relieveOversizedPresenterEdge(initialSegments, "last", context.lipSyncMaxDurationSec, eps, fps, words)

  // 1b. Слияние кадров короче минимума монтажного шага (Critical 1 ревью,
  //     переработано в Critical Н-1/Н-2/Н-3 ре-ревью): хвост участвует наравне
  //     с остальными, слияние не создаёт presenter_too_long и не съедает
  //     ВСЕ presenter-кадры — см. докстринги {@link canMergeSafely} и
  //     {@link mergeShortSegments}.
  const { segments, actions } = mergeShortSegments(initialSegments, context)

  // 1c. Слияние могло само подвинуть presenter-кадр на край (например,
  //     поглотив вырожденного НЕ-presenter соседа у самого края таймлайна) —
  //     разгрузку нужно попробовать ЕЩЁ РАЗ по итоговым краям, иначе повторный
  //     прогон ремонта над СВОИМ ЖЕ результатом находил бы разгрузку там, где
  //     первый проход её не видел (найдено тестом-свойством: нарушалась
  //     неподвижная точка).
  relieveOversizedPresenterEdge(segments, "first", context.lipSyncMaxDurationSec, eps, fps, words)
  relieveOversizedPresenterEdge(segments, "last", context.lipSyncMaxDurationSec, eps, fps, words)

  const changes: ShotPlanRepairAction[] = [...actions]

  const materialized: PlannedShot[] = segments.map(seg => ({
    ...seg.source,
    startSec: seg.startSec,
    endSec: seg.endSec,
  }))

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
  for (const shot of materialized) {
    const missingLibraryRef = shot.background === "library"
      && (!shot.backgroundClipId || !context.knownBackgroundIds.has(shot.backgroundClipId))
    const missingAppScreenRef = shot.background === "app_screen" && !shot.appReferenceId

    if (missingLibraryRef || missingAppScreenRef) {
      const previous = shot.background
      shot.background = shot.foreground === "presenter" ? "none" : "image"
      shot.backgroundClipId = null
      changes.push({
        shotOrder: shot.order,
        message: `Кадр ${shot.order}: фон "${previous}" сброшен в "${shot.background}" — ссылка не существует`,
      })
    }
    if (shot.background === "video") {
      const tooShort = shot.endSec - shot.startSec < context.minGenerativeVideoSec - eps
      const disabled = !context.profile.generativeVideoEnabled
      if (tooShort || disabled) {
        shot.background = "image"
        changes.push({
          shotOrder: shot.order,
          message: `Кадр ${shot.order}: генеративное видео заменено картинкой (${tooShort ? "короче минимума длительности" : "флаг профиля выключен"})`,
        })
      }
    }
  }

  // 3. Нумерация подряд с нуля: order — ключ (videoId, order) в БД и позиция в
  //    склейке; дырки в нём означают потерянный кадр.
  materialized.forEach((shot, index) => { shot.order = index })

  const plan: ShotPlan = { shots: materialized }
  const remaining = validateShotPlan({ ...context, plan })
  return { plan, before, remaining, changes }
}
