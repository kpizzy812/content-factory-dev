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

import { snapSecToFrame, trackEndFrame } from "../voiceover/segment-cut"

/** Сколько окно «остывает» после использования. Сутки — один суточный цикл производства. */
export const RECORDING_WINDOW_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * Насколько окно допустимо короче заказанного, в кадрах.
 *
 * Реальные длительности приходят из замера файла и из выравнивания трека и по
 * кадру почти никогда не выровнены. Конец окна округляется ВВЕРХ (см. ниже),
 * поэтому обычно окно длиннее звука; но если верхняя граница не помещается в
 * запись, её приходится прижать вниз к последней существующей границе кадра —
 * и тогда окно может оказаться короче заказанного на дробную часть кадра.
 * Расхождение в пределах кадра гасит сборка (spec §8: разница длины правится
 * ВИДЕО — подрезкой или удержанием последнего кадра, звук остаётся эталоном),
 * а отказываться от записи, которая физически есть, из-за долей кадра нельзя.
 */
export const MAX_SHORTFALL_FRAMES = 1

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

/**
 * Ближайшая граница кадра СНИЗУ — не годится для конца окна.
 *
 * Для конца окна нужна граница СВЕРХУ: округление вниз дало бы окно короче
 * заказанного на целый кадр систематически, а не только на стыке с концом
 * записи. `Math.ceil`, а не копия `snapSecToFrame` — та округляет к ближайшей,
 * что для верхней границы окна не тот инструмент (Critical из ревью).
 */
function ceilToFrame(sec: number, fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? Math.ceil(sec * fps) / fps : sec
}

export function planRecordingWindow(input: RecordingWindowInput): RecordingWindow | null {
  const { fps, now, recordingDurationSec, requiredSec } = input
  const cooldownMs = input.cooldownMs ?? RECORDING_WINDOW_COOLDOWN_MS

  if (!Number.isFinite(requiredSec) || requiredSec <= 0) return null
  if (!Number.isFinite(recordingDurationSec) || recordingDurationSec <= 0) return null

  // Интервалы с нечисловыми границами отбрасываем целиком — как и с нечисловым
  // usedAtMs. Один пропуск и overlap() тихо возвращает NaN, а `NaN < best.overlapSec`
  // всегда false, из-за чего первый же кандидат намертво застревает в best
  // (Important из ревью, воспроизведено на startSec: NaN).
  const validIntervals = input.usedIntervals.filter(interval =>
    Number.isFinite(interval.usedAtMs)
    && Number.isFinite(interval.startSec)
    && Number.isFinite(interval.endSec))

  // Горячими считаем только те интервалы, что ещё не остыли: вчерашнее занятие
  // не должно блокировать материал навсегда, иначе библиотека выработается за
  // неделю.
  const hot = validIntervals.filter(interval => now - interval.usedAtMs < cooldownMs)

  // Последняя граница кадра, которая реально существует в записи — дальше неё
  // кадров нет. Та же функция, что режет конец трека в segment-cut.ts: смысл
  // идентичный, только объект другой (видеозапись, а не аудиотрек).
  const recordingEnd = trackEndFrame(recordingDurationSec, fps)

  const frameSec = Number.isFinite(fps) && fps > 0 ? 1 / fps : 0
  const maxShortfallSec = frameSec * MAX_SHORTFALL_FRAMES

  // Кандидаты — начала окон с шагом в один кадр (или полсекунды без fps).
  const step = fps > 0 ? 1 / fps : 0.5
  // Верхняя граница перебора НЕ раздвинута под допуск в кадр: раздвижка даёт
  // у самого конца записи позиции, чьё окно прижимается к recordingEnd и
  // становится короче остальных кандидатов. У более короткого окна меньше
  // абсолютных секунд пересечения с тем же интервалом просто потому, что оно
  // короче, — не потому, что участок менее использован, — и такая позиция
  // выигрывала бы ранжирование не по смыслу, а по артефакту сравнения окон
  // разной длины. Единственный кандидат, которому клэмп при этом нужен, —
  // последний в ЭТОМ (нерасширенном) диапазоне: у него верхняя граница уже
  // после округления вверх может вылезти за recordingDurationSec ровно на то,
  // что чинит Critical (§8 брифа) — доли кадра на стыке с концом записи.
  const lastStart = recordingDurationSec - requiredSec

  let best: RecordingWindow | null = null
  let bestAllOverlapSec = Number.POSITIVE_INFINITY
  for (let start = 0; start <= lastStart + 1e-9; start += step) {
    const snappedStart = Math.max(0, snapSecToFrame(start, fps))
    // Конец — вверх до кадра: окно по умолчанию не короче заказанного. Если
    // это не помещается в запись, прижимаем к последней существующей границе
    // кадра записи; получившаяся недостача проверяется ниже.
    const idealEnd = ceilToFrame(snappedStart + requiredSec, fps)
    const snappedEnd = idealEnd <= recordingEnd + 1e-6 ? idealEnd : recordingEnd
    if (snappedEnd <= snappedStart) continue

    const durationSec = snappedEnd - snappedStart
    if (requiredSec - durationSec > maxShortfallSec + 1e-9) continue

    // Ранжирование — по двум ключам: сначала перекрытие с ГОРЯЧИМИ интервалами,
    // при равенстве — перекрытие со ВСЕМИ. Одного hot-ключа мало: остывший
    // интервал даёт overlapSec = 0 — ровно как никогда не тронутый участок, и
    // при равенстве побеждал бы более ранний по сканированию (Important из
    // ревью — остывшая голова записи забивала нетронутый хвост).
    let hotOverlapSec = 0
    for (const interval of hot) {
      hotOverlapSec += overlap(snappedStart, snappedEnd, interval.startSec, interval.endSec)
    }

    // Второй ключ считаем, только если кандидат ещё в борьбе за первый: если
    // hotOverlapSec уже хуже текущего best, второй ключ его не спасёт — цикл
    // по всем интервалам на заведомо проигрышную позицию не тратим (Minor из
    // ревью: раньше он считался на каждой позиции без всякой пользы).
    if (best !== null && hotOverlapSec > best.overlapSec) continue

    let allOverlapSec = 0
    for (const interval of validIntervals) {
      allOverlapSec += overlap(snappedStart, snappedEnd, interval.startSec, interval.endSec)
    }

    const isBetter = best === null
      || hotOverlapSec < best.overlapSec
      || allOverlapSec < bestAllOverlapSec

    if (isBetter) {
      best = {
        startSec: snappedStart,
        endSec: snappedEnd,
        durationSec,
        overlapSec: hotOverlapSec,
        reused: allOverlapSec > 0,
      }
      bestAllOverlapSec = allOverlapSec
      // Нетронутое место найдено по обоим ключам — дальше искать нечего.
      if (hotOverlapSec === 0 && allOverlapSec === 0) break
    }
  }

  return best
}
