/**
 * Окно реза внутри длинной записи ведущего.
 *
 * Раньше единицей выбора был готовый клип фиксированной длины, и cooldown жил
 * счётчиком на нём (`PresenterSourceClip.usageCount`). При нарезке по требованию
 * единицей становится произвольное окно, у которого счётчика нет: без отдельного
 * учёта требование docs/PROJECT_CONTEXT.md §7 («cooldown повторного
 * использования фрагмента») перестало бы выполняться ровно там, где включается
 * главная фича (spec §6.2).
 *
 * Правило чистое: БД сюда не ходит, время передаётся снаружи. Занятые интервалы
 * и их давность приносит вызывающий из `PresenterRecordingUsage`.
 */

import { snapSecToFrame } from "../voiceover/segment-cut"

/** Сколько окно «остывает» после использования. Сутки — один суточный цикл производства. */
export const RECORDING_WINDOW_COOLDOWN_MS = 24 * 60 * 60 * 1000

export interface UsedInterval {
  startSec: number
  endSec: number
  usedAtMs: number
}

export interface RecordingWindowInput {
  recordingDurationSec: number
  /** Длина кадра, которую надо покрыть. Обычно — длина вырезанного куска трека. */
  requiredSec: number
  /** Частота сборки; <= 0 — притягивать границы не к чему. */
  fps: number
  usedIntervals: readonly UsedInterval[]
  /** Текущее время, мс. Снаружи — чтобы правило оставалось чистым. */
  now: number
  cooldownMs?: number
}

export interface RecordingWindow {
  startSec: number
  endSec: number
  durationSec: number
  /** Сколько секунд окна пересекается с ещё не остывшими интервалами. */
  overlapSec: number
  /** true — нетронутого места не осталось, взят остывший участок. */
  reused: boolean
}

/** Пересечение двух отрезков в секундах. */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

export function planRecordingWindow(input: RecordingWindowInput): RecordingWindow | null {
  const { fps, now, recordingDurationSec, requiredSec } = input
  const cooldownMs = input.cooldownMs ?? RECORDING_WINDOW_COOLDOWN_MS

  if (!Number.isFinite(requiredSec) || requiredSec <= 0) return null
  if (!Number.isFinite(recordingDurationSec) || recordingDurationSec <= 0) return null
  if (recordingDurationSec + 1e-6 < requiredSec) return null

  // Горячими считаем только те интервалы, что ещё не остыли: вчерашнее занятие
  // не должно блокировать материал навсегда, иначе библиотека выработается за
  // неделю.
  const hot = input.usedIntervals.filter(interval =>
    Number.isFinite(interval.usedAtMs) && now - interval.usedAtMs < cooldownMs)

  // Кандидаты — начала окон с шагом в один кадр (или полсекунды без fps).
  // Перебор дешёвый: запись десять минут даёт порядка 18 000 позиций, и это
  // одна арифметическая операция на позицию.
  const step = fps > 0 ? 1 / fps : 0.5
  const lastStart = recordingDurationSec - requiredSec

  let best: RecordingWindow | null = null
  for (let start = 0; start <= lastStart + 1e-9; start += step) {
    const snappedStart = Math.max(0, snapSecToFrame(start, fps))
    const snappedEnd = snapSecToFrame(snappedStart + requiredSec, fps)
    if (snappedEnd > recordingDurationSec + 1e-6) break

    let overlapSec = 0
    for (const interval of hot) {
      overlapSec += overlap(snappedStart, snappedEnd, interval.startSec, interval.endSec)
    }

    // overlapSec считается по горячим интервалам (для ранжирования);
    // reused считается по ВСЕМ интервалам (для определения повторного использования).
    // Смысл: при выборе между кандидатами предпочитаем тот, что меньше пересекается
    // с недавним использованием; но если вся запись занята (даже если остывшей),
    // выбранное окно отмечаем как повторное — это влияет на корректировку расписания.
    let reusedWindow = false
    for (const interval of input.usedIntervals) {
      if (Number.isFinite(interval.usedAtMs) &&
          overlap(snappedStart, snappedEnd, interval.startSec, interval.endSec) > 0) {
        reusedWindow = true
        break
      }
    }

    if (best === null || overlapSec < best.overlapSec) {
      best = {
        startSec: snappedStart,
        endSec: snappedEnd,
        durationSec: snappedEnd - snappedStart,
        overlapSec,
        reused: reusedWindow,
      }
      // Нетронутое место найдено — дальше искать нечего, лучше уже не будет.
      if (overlapSec === 0) break
    }
  }

  return best
}
