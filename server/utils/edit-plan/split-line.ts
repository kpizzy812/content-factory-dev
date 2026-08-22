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
 * Фикс-раунд (task-4-review, поправка 2 задания): черновой алгоритм из брифа
 * мог зависнуть. Цикл продвигал `cursor` результатом притяжки к кадру
 * (`snapSecToFrame`), а притяжка ОКРУГЛЯЕТ — если снапнутая точка реза (середина
 * найденной паузы или начало/конец узкой паузы под перебивку) попадала РОВНО на
 * `cursor` (пауза узкая и стоит вплотную к текущей границе), продвижения не
 * происходило: следующая итерация видела тот же `cursor`, находила ту же самую
 * паузу и возвращала ту же самую точку — бесконечный цикл, а не падение теста.
 * То же в ветке перебивки: `from` (притянутое начало короткой паузы) могло
 * оказаться РАВНО `cursor` (округление вниз до того же кадра, что и текущая
 * граница) — тогда часть до перебивки получала бы нулевую длину.
 *
 * Лечение — {@link resolveIteration}: каждый кандидат на рез (все три пункта
 * порядка) принимается только если он гарантированно продвигает курсор минимум
 * на один кадр вперёд ({@link ensuresAdvance}); часть до перебивки в пункте 2
 * дополнительно обязана быть строго положительной длины. Если ни один из трёх
 * пунктов порядка не даёт годной точки — это значит, что рядом с курсором нет
 * ни одной паузы, за которую можно зацепиться без риска зависнуть, и тогда
 * применяется четвёртый, безусловный случай: рез ровно по потолку модели
 * (`snapSecToFrame(limit, fps)`), который гарантированно продвигает курсор на
 * весь `maxDurationSec` (а он на практике всегда на порядки больше одного
 * кадра — 10с потолка против ~33мс кадра на 30fps), то есть завершение цикла
 * гарантировано без ограничения на форму пауз во входных данных.
 */

import { snapSecToFrame } from "../voiceover/segment-cut"
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
  /** Заполнено, когда пришлось резать третьим (или вырожденным четвёртым) способом. */
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

/** Длина кадра — фолбэк на случай негодного fps, тем же приёмом, что и `validate.ts`. */
function frameSec(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? 1 / fps : 1 / 60
}

/**
 * Гарантия продвижения (поправка 2): кандидат на рез принимается, только если
 * он уводит курсор вперёд минимум на один кадр. Без этой проверки узкая пауза,
 * снапнутая к тому же кадру, что и текущий курсор, зациклила бы дробление —
 * см. докстринг модуля.
 */
function ensuresAdvance(cursor: number, candidateCursor: number, fps: number): boolean {
  return candidateCursor >= cursor + frameSec(fps)
}

function resolveIteration(
  cursor: number,
  limit: number,
  pauses: readonly Pause[],
  brollAllowed: boolean,
  fps: number,
  sceneOrder: number,
): { part: { startSec: number, endSec: number }, interlude: { startSec: number, endSec: number } | null, nextCursor: number, warn: string | null } {
  const inRange = pauses.filter(pause => pause.startSec > cursor && pause.endSec <= limit)

  // 1. Самая длинная пауза в пределах потолка — там смена плана намеренная.
  const meaningful = inRange
    .filter(pause => pause.durationSec >= MEANINGFUL_PAUSE_SEC)
    .sort((a, b) => b.durationSec - a.durationSec)[0]
  if (meaningful) {
    const cut = snapSecToFrame((meaningful.startSec + meaningful.endSec) / 2, fps)
    if (ensuresAdvance(cursor, cut, fps)) {
      return { part: { startSec: cursor, endSec: cut }, interlude: null, nextCursor: cut, warn: null }
    }
  }

  // 2. Перебивка на самой широкой из оставшихся (заведомо не "намеренных") пауз:
  //    короткая пауза всё равно есть, но её мало для смены ракурса ведущего —
  //    зато хватает, чтобы показать другой кадр между частями.
  if (brollAllowed) {
    const widest = inRange.slice().sort((a, b) => b.durationSec - a.durationSec)[0]
    if (widest) {
      // Поправка 2: `from` зажат снизу значением `cursor`, а само разбиение
      // принимается только если часть ДО перебивки положительной длины (иначе
      // округление узкой паузы вниз к текущему кадру дало бы вырожденный кадр)
      // и перебивка реально продвигает курсор хотя бы на кадр.
      const from = Math.max(cursor, snapSecToFrame(widest.startSec, fps))
      const to = snapSecToFrame(widest.endSec, fps)
      if (from > cursor && to > from && ensuresAdvance(cursor, to, fps)) {
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
  //    (максимально использует разрешённую длину части), о чём надо сказать
  //    вслух. Перебираем от ближайшего к потолку к самому раннему — первый же
  //    прошедший проверку продвижения побеждает.
  const byProximityToLimit = inRange.slice().sort((a, b) => b.startSec - a.startSec)
  for (const pause of byProximityToLimit) {
    const cut = snapSecToFrame((pause.startSec + pause.endSec) / 2, fps)
    if (ensuresAdvance(cursor, cut, fps)) {
      return {
        part: { startSec: cursor, endSec: cut },
        interlude: null,
        nextCursor: cut,
        warn: `WARN реплику сцены ${sceneOrder} пришлось резать по межсловному интервалу `
          + `в ${cut.toFixed(2)}с: подходящей паузы нет, перебивка ${brollAllowed ? "не помогла" : "запрещена профилем"}`,
      }
    }
  }

  // 4. Вырожденный случай (поправка 2): рядом с курсором нет НИ ОДНОЙ паузы,
  //    за которую можно было бы зацепиться без риска не продвинуться вперёд
  //    (либо пауз в диапазоне вообще нет — слова идут встык, либо все
  //    найденные слишком узкие и снапаются обратно в текущий кадр). Резать
  //    ровно по потолку модели: это гарантированно продвигает курсор на весь
  //    `maxDurationSec`, а не на один кадр, и на практике потолок (десятки
  //    кадров) на порядки больше кадра — цикл завершается за конечное число
  //    шагов при любой форме пауз во входных данных.
  const cut = snapSecToFrame(limit, fps)
  return {
    part: { startSec: cursor, endSec: cut },
    interlude: null,
    nextCursor: cut,
    warn: `WARN реплику сцены ${sceneOrder} пришлось резать по потолку модели в ${cut.toFixed(2)}с: `
      + `рядом нет ни одной паузы, гарантированно продвигающей рез вперёд`,
  }
}

export function splitLongPresenterLine(input: SplitLineInput): SplitLineResult {
  const { fps, maxDurationSec, scene } = input
  if (scene.words.length === 0) return { parts: [], interludes: [], warning: null }

  const startSec = snapSecToFrame(scene.startSec, fps)
  const endSec = snapSecToFrame(scene.endSec, fps)
  if (endSec - startSec <= maxDurationSec) {
    return { parts: [{ startSec, endSec }], interludes: [], warning: null }
  }

  const pauses = collectPauses(scene)
  const parts: Array<{ startSec: number, endSec: number }> = []
  const interludes: Array<{ startSec: number, endSec: number }> = []
  let warning: string | null = null

  let cursor = startSec
  while (endSec - cursor > maxDurationSec) {
    const limit = cursor + maxDurationSec
    const result = resolveIteration(cursor, limit, pauses, input.brollAllowed, fps, scene.order)

    parts.push(result.part)
    if (result.interlude) interludes.push(result.interlude)
    if (result.warn && !warning) warning = result.warn
    cursor = result.nextCursor
  }

  if (endSec > cursor) parts.push({ startSec: cursor, endSec })

  return { parts, interludes, warning }
}
