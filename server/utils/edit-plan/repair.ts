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
 */

import { snapSecToFrame, trackEndFrame } from "../voiceover/segment-cut"
import type { PlannedShot, ShotPlan } from "./types"
import { validateShotPlan, type ShotPlanContext, type ShotPlanViolation } from "./validate"

/** Межсловные интервалы: пары (конец слова, начало следующего). */
interface WordGap {
  startSec: number
  endSec: number
}

function collectGaps(context: ShotPlanContext): WordGap[] {
  const words = context.alignedScenes
    .flatMap(scene => scene.words)
    .slice()
    .sort((a, b) => a.startSec - b.startSec)

  const gaps: WordGap[] = []
  for (let index = 0; index + 1 < words.length; index += 1) {
    const end = words[index]!.endSec
    const next = words[index + 1]!.startSec
    if (next > end) gaps.push({ startSec: end, endSec: next })
  }
  return gaps
}

/**
 * Ближайшая точка, в которой смена картинки не рвёт слово.
 *
 * Целимся в середину щели, а не в её край: край совпадает с началом или концом
 * слова, и притяжка к кадру сдвинет его внутрь соседнего.
 */
function nearestSafePoint(gaps: readonly WordGap[], atSec: number, fps: number): number {
  if (gaps.length === 0) return snapSecToFrame(atSec, fps)

  let best = gaps[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const middle = (gap.startSec + gap.endSec) / 2
    const distance = Math.abs(middle - atSec)
    if (distance < bestDistance) {
      bestDistance = distance
      best = gap
    }
  }
  return snapSecToFrame((best.startSec + best.endSec) / 2, fps)
}

export function repairShotPlan(
  context: ShotPlanContext,
): { plan: ShotPlan, repaired: ShotPlanViolation[] } {
  const before = validateShotPlan(context)
  const gaps = collectGaps(context)
  const { fps, trackDurationSec } = context

  const shots: PlannedShot[] = context.plan.shots
    .map(shot => ({ ...shot }))
    .sort((a, b) => a.startSec - b.startSec)

  // 1. Границы: старт первого — ноль, каждая внутренняя — безопасная точка,
  //    конец последнего — конец трека. Кадры идут встык по построению, поэтому
  //    ни дыр, ни нахлёстов после этого прохода не остаётся.
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!
    shot.startSec = index === 0
      ? 0
      : shots[index - 1]!.endSec

    if (index === shots.length - 1) {
      // Не snapSecToFrame: округление к ближайшему кадру может увести
      // границу ЗА фактический конец трека на полкадра. trackEndFrame —
      // граница кадра НЕ ПОЗЖЕ конца трека, ровно то, что нужно верхнему
      // потолку (см. `segment-cut.ts`, тем же приёмом пользуется вырезка
      // кусков трека под lip-sync).
      shot.endSec = trackEndFrame(trackDurationSec, fps)
      continue
    }

    const desiredEnd = Math.min(shot.endSec, trackDurationSec)
    const safeEnd = nearestSafePoint(gaps, desiredEnd, fps)
    // Кадр нулевой длины хуже кадра неровной длины: он ничего не показывает,
    // но занимает строку и стоит денег на генерацию фона.
    shot.endSec = Math.max(safeEnd, shot.startSec + 1 / Math.max(fps, 1))
  }

  // 2. Источники, которые нельзя оставить: несуществующий фон и генеративное
  //    видео на коротком кадре (§7, §10).
  for (const shot of shots) {
    if (shot.background === "library"
      && (!shot.backgroundClipId || !context.knownBackgroundIds.has(shot.backgroundClipId))) {
      shot.background = shot.foreground === "presenter" ? "none" : "image"
      shot.backgroundClipId = null
    }
    if (shot.background === "video"
      && shot.endSec - shot.startSec < context.minGenerativeVideoSec) {
      shot.background = "image"
    }
  }

  // 3. Нумерация подряд с нуля: order — ключ (videoId, order) в БД и позиция в
  //    склейке; дырки в нём означают потерянный кадр.
  shots.forEach((shot, index) => { shot.order = index })

  return { plan: { shots }, repaired: before }
}
