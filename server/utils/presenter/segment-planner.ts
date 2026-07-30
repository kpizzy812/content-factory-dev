/**
 * Планировщик нарезки длинной записи ведущего на короткие пригодные фрагменты.
 *
 * Чистая функция: получает длительность и границы сцен от ffmpeg, отдаёт окна
 * реза. Kling принимает только 2-10 секунд, поэтому длинные куски делятся на
 * равные части, а слишком короткие отбрасываются.
 */

export interface SegmentPlanInput {
  durationSec: number
  /** Таймкоды склеек от detectSceneBoundaries. Мусор и дубли игнорируются. */
  sceneBoundaries: number[]
  minDurationSec?: number
  maxDurationSec?: number
  /** Отступ от склейки, чтобы переход не попал в кадр. */
  paddingSec?: number
}

export interface PlannedSegment {
  startSec: number
  endSec: number
  durationSec: number
  /** Индекс куска между границами сцен, из которого вырос сегмент. */
  sourceBoundaryIndex: number
}

const DEFAULT_MIN_SEC = 2
const DEFAULT_MAX_SEC = 10

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Границы кусков: 0, валидные склейки по возрастанию, конец записи. */
function collectCutPoints(durationSec: number, boundaries: number[]): number[] {
  const points = new Set<number>([0, round(durationSec)])
  for (const raw of boundaries) {
    if (!Number.isFinite(raw)) continue
    const value = round(raw)
    if (value <= 0 || value >= durationSec) continue
    points.add(value)
  }
  return [...points].sort((a, b) => a - b)
}

/**
 * Делит кусок на равные части, каждая не длиннее максимума. Равные, а не
 * «по максимуму плюс огрызок»: иначе на 21 секунде последний кусок был бы
 * односекундным и не прошёл бы по минимуму.
 */
function splitEvenly(
  startSec: number,
  endSec: number,
  minSec: number,
  maxSec: number,
  boundaryIndex: number,
): PlannedSegment[] {
  const total = endSec - startSec
  if (total < minSec) return []
  if (total <= maxSec) {
    return [{
      startSec: round(startSec),
      endSec: round(endSec),
      durationSec: round(total),
      sourceBoundaryIndex: boundaryIndex,
    }]
  }

  const parts = Math.ceil(total / maxSec)
  const partDuration = total / parts
  if (partDuration < minSec) return []

  const segments: PlannedSegment[] = []
  for (let index = 0; index < parts; index += 1) {
    const from = startSec + partDuration * index
    // Последнюю границу берём из endSec, чтобы накопленная ошибка округления
    // не оставляла хвост записи неиспользованным.
    const to = index === parts - 1 ? endSec : startSec + partDuration * (index + 1)
    segments.push({
      startSec: round(from),
      endSec: round(to),
      durationSec: round(to - from),
      sourceBoundaryIndex: boundaryIndex,
    })
  }
  return segments
}

export function planPresenterSegments(input: SegmentPlanInput): PlannedSegment[] {
  const duration = input.durationSec
  if (!Number.isFinite(duration) || duration <= 0) return []

  const minSec = input.minDurationSec ?? DEFAULT_MIN_SEC
  const maxSec = input.maxDurationSec ?? DEFAULT_MAX_SEC
  if (minSec <= 0 || maxSec < minSec) return []

  const padding = Math.max(0, input.paddingSec ?? 0)
  const cutPoints = collectCutPoints(duration, input.sceneBoundaries)

  const segments: PlannedSegment[] = []
  for (let index = 0; index < cutPoints.length - 1; index += 1) {
    const rawStart = cutPoints[index]!
    const rawEnd = cutPoints[index + 1]!
    // Отступ нужен только там, где есть склейка: начало и конец записи не режем.
    const start = index === 0 ? rawStart : rawStart + padding
    const end = index === cutPoints.length - 2 ? rawEnd : rawEnd - padding
    if (end - start < minSec) continue
    segments.push(...splitEvenly(start, end, minSec, maxSec, index))
  }

  return segments
}
