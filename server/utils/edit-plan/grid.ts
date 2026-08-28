/**
 * Сетка кадров: код режет таймлайн по границам слов, до всякого обращения к
 * модели (spec §5.1 — «код считает секунды»).
 *
 * Каждая выровненная сцена делится на отрезки длиной около
 * `profile.shotChangeSec`, границы — ближайшие межсловные интервалы,
 * притянутые к кадру. Presenter-сцены сначала проходят `splitLongPresenterLine`
 * (Task 4): её `parts` становятся кадрами ведущего, её `interludes` — кадрами
 * перебивки между частями одной реплики (sceneOrder: null — они не привязаны
 * ни к какой реплике).
 *
 * Кандидаты на рез приходят из `word-cuts.ts` двумя тирами — паузы и стыки
 * слов (боевой дефект ролика 34, 28.08.2026: на слитной транскрипции пауз нет
 * ни одной, и сетка резала наивно по `cursor + shotChangeSec`, то есть по
 * живому слову). Приоритет паузы над стыком см. в {@link nearestCut}.
 *
 * Сетка не обязана быть идеальной: `repairShotPlan` (Task 3) — гарантированный
 * второй проход, который приводит границы к консистентному виду (не рвёт
 * слово, без дыр и нахлёстов) независимо от того, что вернула модель. Здесь
 * достаточно разумного приближения, а не побитового совпадения с ремонтом —
 * дублировать его логику здесь означало бы поддерживать две копии одного и
 * того же алгоритма.
 */

import { splitLongPresenterLine } from "./split-line"
import { collectWordCutCandidates } from "./word-cuts"
import { snapSecToFrame } from "../voiceover/segment-cut"
import type { WordCutCandidates, WordGap } from "./word-cuts"
import type { AlignedScene, AlignedWord } from "../transcription/align"

export interface ShotGridCell {
  order: number
  startSec: number
  endSec: number
  /** Смысловая сцена сценария. null — перебивка между частями одной реплики. */
  sceneOrder: number | null
}

export interface BuildShotGridInput {
  alignedScenes: readonly AlignedScene[]
  /** Сцены, где ведущий говорит В КАДРЕ (а не только закадровый нарратор). */
  presenterSceneOrders: ReadonlySet<number>
  /** Целевой шаг смены картинки — profile.shotChangeSec. */
  shotChangeSec: number
  /** Потолок lip-sync модели — у kling-lip-sync 10с. */
  lipSyncMaxDurationSec: number
  fps: number
  /** Разрешена ли перебивка между частями длинной реплики (профиль/доля перебивок). */
  brollAllowed: boolean
}

export interface ShotGridResult {
  cells: ShotGridCell[]
  /** WARN из `splitLongPresenterLine` — резы по потолку модели без хорошей паузы рядом. */
  warnings: string[]
}

/** Ближайшая к `desired` точка внутри одного из `gaps`, зажатая интервалом `(lo, hi)`. */
function nearestPointAmong(desired: number, gaps: readonly WordGap[], lo: number, hi: number): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const point = Math.min(Math.max(desired, gap.startSec), gap.endSec)
    if (point <= lo || point >= hi) continue
    const distance = Math.abs(point - desired)
    if (distance < bestDistance) {
      bestDistance = distance
      best = point
    }
  }
  return best
}

/**
 * Точка реза около `desired`, ограниченная интервалом `(lo, hi)`.
 *
 * Порядок — тиры {@link WordCutCandidates}, а не одно расстояние (боевой дефект
 * ролика 34, 28.08.2026): сначала настоящие паузы, и только если ни одна не
 * попала в допустимый интервал — стыки слов. Приоритет именно такой, а не «кто
 * ближе»: смена плана в паузе выглядит намеренной, на стыке слов она резче,
 * поэтому близкий стык не имеет права перебивать паузу, до которой дальше.
 * Побочное следствие приоритета — на транскрипции С паузами поведение сетки не
 * меняется вовсе: стыки до перебора просто не доходят.
 *
 * Не нашлось ни того, ни другого — наивная точка, притянутая к кадру (может
 * прийтись на середину слова, на этот случай и существует `repairShotPlan`).
 */
function nearestCut(desired: number, candidates: WordCutCandidates, lo: number, hi: number, fps: number): number {
  const raw = nearestPointAmong(desired, candidates.pauses, lo, hi)
    ?? nearestPointAmong(desired, candidates.junctions, lo, hi)
    ?? desired
  return snapSecToFrame(Math.min(Math.max(raw, lo), hi), fps)
}

/** Защита от бесконечного цикла на вырожденном входе (targetSec <= 0, fps <= 0). */
const MAX_CUTS_PER_RANGE = 10_000

/** Режет `[startSec, endSec)` на отрезки длиной около `targetSec`, по словам `words`. */
function sliceRange(
  startSec: number,
  endSec: number,
  words: readonly AlignedWord[],
  targetSec: number,
  fps: number,
): Array<{ startSec: number, endSec: number }> {
  if (!(targetSec > 0) || !Number.isFinite(targetSec) || endSec - startSec <= targetSec) {
    return [{ startSec, endSec }]
  }

  const candidates = collectWordCutCandidates(words)
  const minAdvance = Math.max(targetSec * 0.5, Number.isFinite(fps) && fps > 0 ? 1 / fps : 1 / 60)
  const cuts: number[] = []
  let cursor = startSec
  let guard = 0

  // Продолжаем резать, пока остаток заметно больше одного целевого шага —
  // иначе последний отрезок систематически выходил бы короче половины шага.
  while (endSec - cursor > targetSec * 1.5 && guard < MAX_CUTS_PER_RANGE) {
    guard += 1
    const desired = cursor + targetSec
    const cut = nearestCut(desired, candidates, cursor + minAdvance, endSec - minAdvance, fps)
    if (!(cut > cursor + 1e-9)) break // некуда продвигаться — отдаём остаток одним отрезком
    cuts.push(cut)
    cursor = cut
  }

  const bounds = [startSec, ...cuts, endSec]
  const segments: Array<{ startSec: number, endSec: number }> = []
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    segments.push({ startSec: bounds[index]!, endSec: bounds[index + 1]! })
  }
  return segments
}

export function buildShotGrid(input: BuildShotGridInput): ShotGridResult {
  const warnings: string[] = []
  const rawCells: Array<{ startSec: number, endSec: number, sceneOrder: number | null }> = []

  const scenes = [...input.alignedScenes].sort((a, b) => a.startSec - b.startSec)

  for (const scene of scenes) {
    if (input.presenterSceneOrders.has(scene.order)) {
      const split = splitLongPresenterLine({
        scene,
        maxDurationSec: input.lipSyncMaxDurationSec,
        fps: input.fps,
        brollAllowed: input.brollAllowed,
      })
      if (split.warning) warnings.push(split.warning)

      // parts и interludes каждый по отдельности идут по возрастанию времени
      // (см. splitLongPresenterLine), но чередуются они не строго 1:1 —
      // сливаем и сортируем по startSec, чтобы восстановить хронологию.
      const pieces = [
        ...split.parts.map(piece => ({ ...piece, isInterlude: false as const })),
        ...split.interludes.map(piece => ({ ...piece, isInterlude: true as const })),
      ].sort((a, b) => a.startSec - b.startSec)

      for (const piece of pieces) {
        if (piece.isInterlude) {
          rawCells.push({ startSec: piece.startSec, endSec: piece.endSec, sceneOrder: null })
          continue
        }
        const wordsInPiece = scene.words.filter(
          word => word.startSec >= piece.startSec - 1e-6 && word.endSec <= piece.endSec + 1e-6,
        )
        for (const segment of sliceRange(piece.startSec, piece.endSec, wordsInPiece, input.shotChangeSec, input.fps)) {
          rawCells.push({ ...segment, sceneOrder: scene.order })
        }
      }
    } else {
      for (const segment of sliceRange(scene.startSec, scene.endSec, scene.words, input.shotChangeSec, input.fps)) {
        rawCells.push({ ...segment, sceneOrder: scene.order })
      }
    }
  }

  rawCells.sort((a, b) => a.startSec - b.startSec)

  return {
    cells: rawCells.map((cell, index) => ({ order: index, ...cell })),
    warnings,
  }
}
