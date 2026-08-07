/**
 * Окно длительностей, в котором исходник ведущего вообще можно брать под сцену.
 *
 * Раньше выборка кандидатов шла по всему диапазону модели (2-10 с), а «ближайший»
 * искался уже в памяти, в пуле из 50 наименее использованных строк. У персонажа с
 * сотней нарезанных сегментов (ingest режет записи на куски 2-10 с) клипы нужной
 * длины в этот пул просто не попадали: их вытесняли короткие с меньшим usageCount.
 * Сужаем окно ДО запроса — тогда усечение по usageCount перестаёт быть опасным.
 *
 * Чистая функция без БД — накрыта DB-free тестом.
 */

export interface PresenterDurationWindowInput {
  /** Плановая длительность сцены из videoPlan. */
  sceneDurationSec: number
  /** Нижняя граница lip-sync модели. */
  minDurationSec: number
  /** Верхняя граница lip-sync модели. */
  maxDurationSec: number
  /** Допустимое расхождение с плановой длиной сцены. */
  maxDeltaSec: number
}

export interface PresenterDurationWindow {
  minSec: number
  maxSec: number
  /** Куда целимся внутри окна — плановая длина сцены, зажатая в его границы. */
  targetSec: number
  maxDeltaSec: number
}

/**
 * Пересечение диапазона модели и окна ±maxDeltaSec вокруг плановой длины сцены.
 * null — пересечения нет: сцену модель не покрывает (например 30 с при пределе 10 с),
 * и подставлять исходник ведущего нельзя, он молча укоротит сцену.
 */
export function buildPresenterDurationWindow(
  input: PresenterDurationWindowInput,
): PresenterDurationWindow | null {
  const { sceneDurationSec, minDurationSec, maxDurationSec, maxDeltaSec } = input
  if (!Number.isFinite(sceneDurationSec) || sceneDurationSec <= 0) return null
  if (!Number.isFinite(minDurationSec) || !Number.isFinite(maxDurationSec)) return null
  if (minDurationSec > maxDurationSec) return null

  const delta = Number.isFinite(maxDeltaSec) && maxDeltaSec > 0 ? maxDeltaSec : 0
  const minSec = Math.max(minDurationSec, sceneDurationSec - delta)
  const maxSec = Math.min(maxDurationSec, sceneDurationSec + delta)
  if (minSec > maxSec) return null

  return {
    minSec,
    maxSec,
    targetSec: Math.min(maxSec, Math.max(minSec, sceneDurationSec)),
    maxDeltaSec: delta,
  }
}
