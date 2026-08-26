/**
 * Реплика сцены, разбитая на части под потолок lip-sync модели.
 *
 * Спека §5.3 требует, чтобы реплика длиннее потолка (`kling-lip-sync` — 10с)
 * НЕ обрезалась, а дробилась: каждая часть уходит в модель своим вызовом, и
 * вместе они покрывают реплику целиком. До этого модуля `planSegmentCut`
 * вырезал из трека окно `[начало сцены, +потолок]`, то есть ПРЕФИКС: на ролике
 * 30 финальная сцена (11.36с, призыв к действию) синхронизировалась только
 * первые 10с, а остаток шёл фоном.
 *
 * Сам порядок реза здесь НЕ реализован — он уже написан и покрыт тестами в
 * `edit-plan/split-line.ts` (`splitLongPresenterLine`, Task 4 плана B): самая
 * длинная пауза → перебивка между частями → ближайший межсловный интервал с
 * WARN → потолок модели. Второго алгоритма быть не должно: план монтажа
 * (`edit-plan/grid.ts`) режет сцену на кадры ТЕМ ЖЕ вызовом, и расхождение
 * между «где план ждёт смену плана» и «где lip-sync реально сменил ракурс»
 * означало бы кадр, которому не хватает живого материала, — ровно тот дефект,
 * который здесь и чинится.
 *
 * Этот модуль добавляет к нему ровно две вещи, которых у чистого дробления
 * нет и быть не может:
 *
 *  1. **Границы трека.** Часть не имеет права вылезти за конец единого трека —
 *     звука там нет. Клэмп тот же, что у `planSegmentCut`
 *     (`trackEndFrame`/`snapSecToFrame`), поэтому одна часть на сцену даёт
 *     ПОБАЙТОВО те же границы, что маршрут давал до дробления.
 *  2. **Сцена без пословных границ.** `splitLongPresenterLine` на сцене без
 *     слов возвращает пустой список: дробить по паузам нечего, а по таймеру
 *     §5.3 запрещает прямо («склейка двух вырезок из разных мест записи
 *     посреди слова читается как рывок»). Такая сцена честно остаётся ОДНОЙ
 *     частью — и именно для неё продолжает жить нарушение
 *     `presenter_scene_too_long` (`edit-plan/validate.ts`): дробление
 *     невозможно, значит кадры за окном модели обязаны стать перебивкой.
 */

import { splitLongPresenterLine } from "../edit-plan/split-line"
import { snapSecToFrame, trackEndFrame } from "../voiceover/segment-cut"
import type { AlignedScene } from "../transcription/align"

/** Одна часть реплики: её интервал В ТРЕКЕ и порядковый номер внутри сцены. */
export interface LipSyncPartPlan {
  /** 0-based номер части внутри сцены. Часть 0 — начало реплики. */
  index: number
  startSec: number
  endSec: number
}

export interface PlanLipSyncPartsInput {
  scene: Pick<AlignedScene, "order" | "startSec" | "endSec" | "words">
  /** Потолок lip-sync модели: у `kling-lip-sync` это 10с. */
  maxDurationSec: number
  fps: number
  /**
   * Разрешена ли перебивка между частями (профиль монтажа: `brollRatio > 0`).
   *
   * Значение обязано совпадать с тем, что получил `buildShotGrid` того же
   * ролика: перебивка сдвигает точки реза, и на разных значениях план и
   * исполнение разошлись бы в границах частей.
   */
  brollAllowed: boolean
  /** Длительность общего трека — за его конец часть не вылезает. */
  trackDurationSec?: number
}

export interface LipSyncPartsPlan {
  /** Части по возрастанию времени. Пусто — интервал сцены вырожден. */
  parts: LipSyncPartPlan[]
  /** Дробление невозможно (нет пословных границ) — реплика идёт одной частью. */
  splitUnavailable: boolean
  /** WARN из `splitLongPresenterLine` — вынужденные резы без хорошей паузы. */
  warning: string | null
}

/**
 * Части реплики сцены под потолок модели.
 *
 * Сцена короче потолка возвращает РОВНО ОДНУ часть с границами сцены — тот же
 * вход, который `planSegmentCut` получал до дробления, и та же цена: один
 * платный вызов.
 */
export function planLipSyncParts(input: PlanLipSyncPartsInput): LipSyncPartsPlan {
  const { fps, scene } = input
  const trackEnd = trackEndFrame(input.trackDurationSec ?? Number.POSITIVE_INFINITY, fps)

  // Тот же порядок клэмпа, что у planSegmentCut: кадр, затем конец трека.
  // Иначе дробление считало бы длину сцены по границам, которых в треке нет.
  let startSec = Math.min(Math.max(0, snapSecToFrame(scene.startSec, fps)), trackEnd)
  let endSec = Math.min(snapSecToFrame(scene.endSec, fps), trackEnd)
  if (!Number.isFinite(startSec)) startSec = 0
  if (!Number.isFinite(endSec) || endSec < startSec) endSec = startSec

  const whole: LipSyncPartPlan[] = endSec > startSec ? [{ index: 0, startSec, endSec }] : []

  const split = splitLongPresenterLine({
    scene: { ...scene, startSec, endSec, words: scene.words } as AlignedScene,
    maxDurationSec: input.maxDurationSec,
    fps,
    brollAllowed: input.brollAllowed,
  })

  const parts = split.parts
    .filter(part => Number.isFinite(part.startSec) && Number.isFinite(part.endSec) && part.endSec > part.startSec)
    .sort((a, b) => a.startSec - b.startSec)
    .map((part, index) => ({ index, startSec: part.startSec, endSec: part.endSec }))

  if (parts.length === 0) {
    // Слов у сцены нет (или все части выродились): резать по паузам нечего.
    // Реплика идёт одной частью — прежнее поведение маршрута, а не тишина.
    return { parts: whole, splitUnavailable: whole.length > 0, warning: split.warning }
  }

  return { parts, splitUnavailable: false, warning: split.warning }
}

/**
 * Окно, которое клип части реально покрывает: её собственная длина, зажатая
 * потолком модели ровно так же, как её зажмёт `planSegmentCut` при вырезке.
 *
 * Нужно валидации и ремонту плана (`presenter_scene_too_long`): после
 * дробления части заведомо укладываются в потолок и окно совпадает с частью,
 * но у сцены без пословных границ часть одна и она длиннее потолка — там
 * окно по-прежнему обрывается, и кадры за ним обязаны стать перебивкой.
 */
export function partCoverageEndSec(part: LipSyncPartPlan, maxDurationSec: number): number {
  if (!Number.isFinite(maxDurationSec) || maxDurationSec <= 0) return part.endSec
  return Math.min(part.endSec, part.startSec + maxDurationSec)
}

/**
 * Достаёт ли живой материал ХОТЬ ОДНОЙ части до всего интервала кадра.
 *
 * ОДИН источник истины для валидации, ремонта и пост-ремонтного цикла раннера:
 * расхождение между «что обвиняем», «что чиним» и «что ставим» уже однажды
 * породило Critical на этой ветке.
 *
 * Начало кадра сверяется только со ВТОРОЙ части и дальше. У первой не
 * сверяется намеренно: ремонт закрывает дыру между сценами, сдвигая границу
 * кадра НАЗАД, за начало его сцены (`ALIGNED` в тестах раннера: сцена 1
 * кончается на 4.0, сцена 2 начинается на 4.2), и прежняя проверка — только по
 * концу окна — этого никогда не запрещала. Требовать теперь ещё и начало
 * значило бы отобрать ведущего у кадров, которым он законно доставался до
 * дробления.
 */
export function shotCoveredByParts(
  parts: readonly LipSyncPartPlan[],
  shotStartSec: number,
  shotEndSec: number,
  maxDurationSec: number,
  epsSec: number,
): boolean {
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!
    if (shotEndSec > partCoverageEndSec(part, maxDurationSec) + epsSec) continue
    if (index > 0 && shotStartSec < part.startSec - epsSec) continue
    return true
  }
  return false
}
