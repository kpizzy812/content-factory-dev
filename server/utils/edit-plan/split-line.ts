/**
 * Реплика длиннее потолка lip-sync модели.
 *
 * Дробить по таймеру нельзя: склейка двух вырезок из разных мест записи посреди
 * слова читается как рывок. Порядок §5.3:
 *
 *   1. резать по самой длинной паузе внутри реплики — там смена плана выглядит
 *      намеренной;
 *   2. если подходящей паузы нет — ставить между частями перебивку, тогда
 *      склейка двух ракурсов ведущего вообще не встречается в кадре;
 *   3. и только если запрещено и это — резать по ближайшему межсловному
 *      интервалу с записью WARN в лог шага.
 *
 * Функция чистая: границы приходят из выравнивания, потолок — из спеки модели.
 *
 * Фикс-раунд 1 (task-4-review.md, поправка 2 задания): черновой алгоритм из брифа
 * мог зависнуть. Цикл продвигал `cursor` результатом притяжки к кадру
 * (`snapSecToFrame`), а притяжка ОКРУГЛЯЕТ — если снапнутая точка реза попадала
 * РОВНО на `cursor`, продвижения не происходило: следующая итерация видела тот
 * же `cursor`, находила ту же самую паузу и возвращала ту же самую точку —
 * бесконечный цикл. Лечение — {@link ensuresAdvance}: каждый кандидат на рез
 * принимается только если гарантированно продвигает курсор минимум на кадр
 * вперёд; если ни один из трёх пунктов порядка не даёт годной точки — четвёртый,
 * безусловный случай: рез ровно по потолку модели.
 *
 * Фикс-раунд 2 (ре-ревью task-4-review.md, 7 Important):
 * - **И-1.** `ensuresAdvance` сравнивал два по-разному вычисленных числа БЕЗ
 *   допуска на шум плавающей точки: `cursor + 1/fps` и снапнутый кандидат — на
 *   `fps=24, cursor=7/24` разница накапливается в последнем разряде double и
 *   ЗАКОННЫЙ однокадровый рез отвергался (замер ре-ревью: 1187 из 10000 комбинаций).
 *   Добавлен допуск `ADVANCE_FLOAT_GUARD = 1e-9` — та же величина, что `FLOAT_GUARD`
 *   в `background-source.ts`. Отдельно: порог «один кадр» решает задачу
 *   ЗАВЕРШЕНИЯ, но не задачу §5.3 «смена плана выглядит намеренной» — часть в
 *   один кадр (33 мс) для монтажа неотличима от брака. Добавлен второй, более
 *   строгий порог {@link MIN_MEANINGFUL_PART_SEC}, обязательный для веток 1-3
 *   (веток ВЫБОРА хорошего реза); ветка 4 (последний, безусловный случай — резать
 *   уже НЕЧЕГО выбирать) по-прежнему гарантирует только продвижение на кадр,
 *   потому что требовать от неё монтажного минимума при заведомо вырожденном
 *   `maxDurationSec` (И-3) сделало бы завершение цикла недостижимым одновременно
 *   с соблюдением потолка — for a cap smaller than the montage minimum this is
 *   mathematically impossible to satisfy both at once.
 * - **И-2.** Ветки 1 и 2 брали ЕДИНСТВЕННОГО кандидата (экстремум по длительности)
 *   и при его провале сразу отдавали управление дальше по порядку §5.3, даже
 *   если следующий кандидат ТОЙ ЖЕ ступени был бы принят. Переписаны как перебор
 *   ВСЕХ кандидатов по убыванию предпочтения (как уже было в ветке 3) — первый
 *   прошедший все проверки побеждает.
 * - **И-3.** Ветка 4 продвигала курсор ровно на `maxDurationSec`, что доказуемо
 *   достаточно, только если `maxDurationSec > 0`; при `maxDurationSec <= 0`
 *   (в том числе NaN) курсор не двигался вовсе — бесконечный цикл с растущим
 *   `parts`. Добавлен ранний выход: невалидный (нечисловой или неположительный)
 *   `maxDurationSec` — реплика не дробится вовсе, отдаётся ведущему целиком с
 *   WARN, дробить её нечем в принципе. Дополнительно, на случай положительного,
 *   но ýже одного кадра потолка (`0 < maxDurationSec < 1/fps`), сама ветка 4
 *   зажимает свой рез снизу гарантией продвижения — тогда часть выйдет ДЛИННЕЕ
 *   такого (уже вырожденного) потолка, но цикл всё равно завершится.
 * - **И-4.** `snapSecToFrame` на потолке округляет к БЛИЖАЙШЕМУ кадру, а не
 *   вниз — на некратном fps (`29.97`, `23.976`) рез уезжает ЗА `maxDurationSec`
 *   (`snapSecToFrame(10, 29.97) = 10.01001`), и провайдер lip-sync отобьёт такой
 *   кусок уже после оплаты подготовки. Все резы, ограниченные потолком (`limit`),
 *   теперь дополнительно зажимаются `floorToFrame(limit, fps)` — тот же приём,
 *   которым `segment-cut.ts` уже решает эту задачу для конца трека.
 * - **М-7.** Раньше сохранялся только ПЕРВЫЙ WARN (`if (result.warn && !warning)`) —
 *   длинная реплика с несколькими вынужденными резами теряла информацию обо всех,
 *   кроме первого. Теперь сообщения накапливаются в одну строку (тип
 *   `warning: string | null` не меняется — интерфейс брифа сохранён).
 * - **М-15.** `NaN` в `scene.startSec`/`scene.endSec` раньше молча гасил оба
 *   ранних выхода и хвостовую дозапись, отдавая `{parts: [], warning: null}` —
 *   неотличимо от честного «слов нет». Теперь явно проверяется и даёт WARN.
 */

import { floorToFrame, snapSecToFrame } from "../voiceover/segment-cut"
import type { AlignedScene } from "../transcription/align"

export interface SplitLineInput {
  scene: AlignedScene
  /** Потолок lip-sync модели: у kling-lip-sync это 10 с. */
  maxDurationSec: number
  fps: number
  /** Разрешена ли перебивка между частями (профиль может её запретить). */
  brollAllowed: boolean
}

export interface SplitLineResult {
  /** Отрезки, которые играет ведущий. */
  parts: Array<{ startSec: number, endSec: number }>
  /** Отрезки под перебивку между частями. Пусто — перебивок нет. */
  interludes: Array<{ startSec: number, endSec: number }>
  /** Заполнено, когда пришлось резать третьим/четвёртым способом. Несколько
   *  сообщений склеены переводом строки — М-7, тип не меняется. */
  warning: string | null
}

interface Pause {
  startSec: number
  endSec: number
  durationSec: number
}

/** Паузы между соседними словами реплики. */
function collectPauses(scene: AlignedScene): Pause[] {
  const words = [...scene.words].sort((a, b) => a.startSec - b.startSec)
  const pauses: Pause[] = []
  for (let index = 0; index + 1 < words.length; index += 1) {
    const startSec = words[index]!.endSec
    const endSec = words[index + 1]!.startSec
    if (endSec > startSec) pauses.push({ startSec, endSec, durationSec: endSec - startSec })
  }
  return pauses
}

/** Пауза достаточной длины, чтобы смена плана в ней выглядела намеренной. */
const MEANINGFUL_PAUSE_SEC = 0.35

/**
 * Минимальная длина ЧАСТИ (не паузы), при которой рез в ветках 1-3 ещё
 * считается монтажным резом, а не стробом (И-1 ре-ревью: часть в один кадр —
 * 33 мс — неотличима от брака монтажа). Совпадает с {@link MEANINGFUL_PAUSE_SEC}
 * намеренно: оба числа отвечают на один и тот же вопрос — «достаточно ли это
 * долго, чтобы выглядеть намеренным, а не случайным», просто применительно к
 * разным величинам (пауза vs часть). Ветка 4 этой проверке не подчиняется —
 * см. докстринг модуля, пункт И-3.
 */
const MIN_MEANINGFUL_PART_SEC = MEANINGFUL_PAUSE_SEC

/** Длина кадра — фолбэк на случай негодного fps, тем же приёмом, что и `validate.ts`. */
function frameSec(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? 1 / fps : 1 / 60
}

/** Допуск на шум плавающей точки — та же величина, что `FLOAT_GUARD` в `background-source.ts`. */
const ADVANCE_FLOAT_GUARD = 1e-9

/**
 * Гарантия продвижения (поправка 2 задания, уточнена И-1 ре-ревью): кандидат
 * на рез принимается, только если он уводит курсор вперёд минимум на кадр —
 * с допуском на шум плавающей точки, иначе `cursor + 1/fps`, посчитанный
 * сложением, и `candidateCursor`, посчитанный округлением, расходятся в
 * последнем разряде double и ЗАКОННЫЙ однокадровый рез отвергается (замер
 * ре-ревью на сетке fps 24/25/30/50/60: 1187 из 10000 комбинаций).
 *
 * Экспортирована для точечного теста на эту самую арифметику — без экспорта
 * воспроизвести конкретный отчётный пример (`fps=24, cursor=7/24, cut=8/24`)
 * через публичный API потребовало бы неестественно маленького `maxDurationSec`.
 */
export function ensuresAdvance(cursor: number, candidateCursor: number, fps: number): boolean {
  return candidateCursor >= cursor + frameSec(fps) - ADVANCE_FLOAT_GUARD
}

/** Часть от `cursor` до кандидата — достаточно ли она длинна, чтобы не быть стробом (И-1). */
function isMeaningfulPart(cursor: number, candidateCursor: number): boolean {
  return candidateCursor - cursor >= MIN_MEANINGFUL_PART_SEC - ADVANCE_FLOAT_GUARD
}

interface IterationResult {
  part: { startSec: number, endSec: number }
  interlude: { startSec: number, endSec: number } | null
  nextCursor: number
  warn: string | null
}

function resolveIteration(
  cursor: number,
  limit: number,
  pauses: readonly Pause[],
  brollAllowed: boolean,
  fps: number,
  sceneOrder: number,
): IterationResult {
  const inRange = pauses.filter(pause => pause.startSec > cursor && pause.endSec <= limit)
  // И-4: ни один рез, ограниченный потолком, не имеет права уйти ЗА него —
  // `snapSecToFrame` округляет к ближайшему кадру и на некратном fps может
  // дать точку выше `limit`; `floorToFrame` — граница НЕ ПОЗЖЕ `limit`.
  const capSec = floorToFrame(limit, fps)

  // 1. Самая длинная пауза в пределах потолка — там смена плана намеренная.
  //    И-2: перебираем ВСЕХ кандидатов по убыванию длительности, а не только
  //    самого длинного — провал геометрии у одного не должен ронять приоритет
  //    §5.3 на ступень вниз, если следующий по длине кандидат годится.
  const meaningfulSorted = inRange
    .filter(pause => pause.durationSec >= MEANINGFUL_PAUSE_SEC)
    .sort((a, b) => b.durationSec - a.durationSec)
  for (const pause of meaningfulSorted) {
    const cut = Math.min(snapSecToFrame((pause.startSec + pause.endSec) / 2, fps), capSec)
    if (ensuresAdvance(cursor, cut, fps) && isMeaningfulPart(cursor, cut)) {
      return { part: { startSec: cursor, endSec: cut }, interlude: null, nextCursor: cut, warn: null }
    }
  }

  // 2. Перебивка на широкой из оставшихся (заведомо не "намеренных") пауз:
  //    короткая пауза всё равно есть, но её мало для смены ракурса ведущего —
  //    зато хватает, чтобы показать другой кадр между частями. И-2: тот же
  //    перебор всех кандидатов, что и в ветке 1.
  if (brollAllowed) {
    const widestSorted = inRange.slice().sort((a, b) => b.durationSec - a.durationSec)
    for (const pause of widestSorted) {
      // `from` зажат снизу значением `cursor` (поправка 2) и сверху `capSec`
      // (И-4); `to` — тоже сверху `capSec`. Часть ДО перебивки обязана быть
      // положительной И монтажно осмысленной (И-1), сама перебивка — тоже
      // положительной.
      const from = Math.max(cursor, Math.min(snapSecToFrame(pause.startSec, fps), capSec))
      const to = Math.min(snapSecToFrame(pause.endSec, fps), capSec)
      if (from > cursor && to > from && ensuresAdvance(cursor, to, fps) && isMeaningfulPart(cursor, from)) {
        return {
          part: { startSec: cursor, endSec: from },
          interlude: { startSec: from, endSec: to },
          nextCursor: to,
          warn: null,
        }
      }
    }
  }

  // 3. Последняя возможность на межсловной паузе: ближайший к потолку интервал
  //    (максимально использует разрешённую длину части — Task 4 первый раунд,
  //    подтверждено ре-ревью как улучшение качества монтажа относительно
  //    брифового «ближайший к курсору»), о чём надо сказать вслух.
  const byProximityToLimit = inRange.slice().sort((a, b) => b.startSec - a.startSec)
  for (const pause of byProximityToLimit) {
    const cut = Math.min(snapSecToFrame((pause.startSec + pause.endSec) / 2, fps), capSec)
    if (ensuresAdvance(cursor, cut, fps) && isMeaningfulPart(cursor, cut)) {
      return {
        part: { startSec: cursor, endSec: cut },
        interlude: null,
        nextCursor: cut,
        warn: `WARN реплику сцены ${sceneOrder} пришлось резать по межсловному интервалу `
          + `в ${cut.toFixed(2)}с: подходящей паузы нет, перебивка ${brollAllowed ? "не помогла" : "запрещена профилем"}`,
      }
    }
  }

  // 4. Вырожденный случай: ни один кандидат из 1-3 не дал одновременно
  //    гарантированное продвижение И монтажно осмысленную часть (либо пауз в
  //    диапазоне вообще нет — слова идут встык). Резать по потолку модели —
  //    единственный оставшийся способ гарантировать продвижение; монтажный
  //    минимум здесь НЕ проверяется (см. докстринг модуля, И-1/И-3): это
  //    последний рубеж перед зависанием, а не выбор среди альтернатив.
  //    `Math.max(capSec, cursor + frameSec(fps))` — И-3: если сам потолок
  //    (`capSec`) недостаточен для гарантии продвижения (вырожденный
  //    `maxDurationSec` уже одного кадра), берём кадр вперёд ценой выхода
  //    части за потолок — альтернатива (не двигаться вовсе) хуже.
  const cut = Math.max(capSec, cursor + frameSec(fps))
  return {
    part: { startSec: cursor, endSec: cut },
    interlude: null,
    nextCursor: cut,
    warn: `WARN реплику сцены ${sceneOrder} пришлось резать по потолку модели в ${cut.toFixed(2)}с: `
      + `рядом нет ни одной паузы, дающей монтажно осмысленный рез`,
  }
}

/** Есть ли смысл вообще пытаться дробить — потолок обязан быть положительным конечным числом. */
function usableMaxDuration(maxDurationSec: number): boolean {
  return Number.isFinite(maxDurationSec) && maxDurationSec > 0
}

export function splitLongPresenterLine(input: SplitLineInput): SplitLineResult {
  const { fps, maxDurationSec, scene } = input
  if (scene.words.length === 0) return { parts: [], interludes: [], warning: null }

  // М-15: нечисловые границы сцены раньше молча гасили оба ранних выхода и
  // хвостовую дозапись, отдавая {parts: [], warning: null} — неотличимо от
  // честного «слов нет». Теперь явно проверяется.
  if (!Number.isFinite(scene.startSec) || !Number.isFinite(scene.endSec)) {
    return {
      parts: [],
      interludes: [],
      warning: `WARN реплика сцены ${scene.order} имеет нечисловую границу `
        + `(startSec=${scene.startSec}, endSec=${scene.endSec}) — дробление невозможно`,
    }
  }

  const startSec = snapSecToFrame(scene.startSec, fps)
  const endSec = snapSecToFrame(scene.endSec, fps)
  if (endSec - startSec <= maxDurationSec) {
    return { parts: [{ startSec, endSec }], interludes: [], warning: null }
  }

  // И-3: невалидный (неположительный/нечисловой) потолок делает дробление по
  // потолку неопределённым — ветка 4 не может гарантировать ни продвижение,
  // ни соблюдение потолка одновременно. Резать нечем — реплика идёт целиком.
  if (!usableMaxDuration(maxDurationSec)) {
    return {
      parts: [{ startSec, endSec }],
      interludes: [],
      warning: `WARN реплику сцены ${scene.order} нельзя дробить: потолок модели `
        + `maxDurationSec=${maxDurationSec} невалиден (должен быть положительным числом)`,
    }
  }

  const pauses = collectPauses(scene)
  const parts: Array<{ startSec: number, endSec: number }> = []
  const interludes: Array<{ startSec: number, endSec: number }> = []
  const warnings: string[] = []

  let cursor = startSec
  while (endSec - cursor > maxDurationSec) {
    const limit = cursor + maxDurationSec
    const result = resolveIteration(cursor, limit, pauses, input.brollAllowed, fps, scene.order)

    parts.push(result.part)
    if (result.interlude) interludes.push(result.interlude)
    // М-7: раньше сохранялся только первый WARN — длинная реплика с
    // несколькими вынужденными резами теряла все сообщения, кроме первого.
    if (result.warn) warnings.push(result.warn)
    cursor = result.nextCursor
  }

  if (endSec > cursor) parts.push({ startSec: cursor, endSec })

  return { parts, interludes, warning: warnings.length > 0 ? warnings.join("\n") : null }
}
