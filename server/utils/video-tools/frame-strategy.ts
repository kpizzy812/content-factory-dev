/**
 * Frame timestamp picker для marketing-grade анализа видео.
 *
 * Стратегия (порт из MarketingCamp `server/utils/video/frame-strategy.ts`,
 * семантика 1-в-1):
 * 1. Adaptive count в зависимости от длительности:
 *      <=15s  → 6 кадров
 *      <=30s  → 8
 *      <=60s  → 10
 *      <=120s → 12
 *      else   → 15
 * 2. Равномерные timestamps с 5% padding с краёв (избегаем чёрных кадров на
 *    intro/outro).
 * 3. Snap каждого равномерного timestamp на ближайший scene boundary в ±tolerance
 *    секунд (default 2с). Каждый boundary используется максимум один раз
 *    (`usedBoundaries` Set), иначе несколько близких равномерных точек схлопнулись
 *    бы в один и тот же кадр.
 * 4. Финальный dedup по timestampSec * 100 (защитная мера; равномерные после
 *    округления коллидировать не должны).
 */
import type { PickedTimestamp, SceneBoundary } from './frame-types'

export function frameCountForDuration(durationSec: number): number {
  if (durationSec <= 15) return 6
  if (durationSec <= 30) return 8
  if (durationSec <= 60) return 10
  if (durationSec <= 120) return 12
  return 15
}

export interface PickTimestampsOptions {
  tolerance?: number
  count?: number
}

export function pickTimestamps(
  durationSec: number,
  sceneBoundaries: SceneBoundary[] = [],
  options: PickTimestampsOptions = {},
): PickedTimestamp[] {
  if (durationSec <= 0) return []

  const count = options.count ?? frameCountForDuration(durationSec)
  if (count <= 0) return []

  const tolerance = options.tolerance ?? 2

  // 5% padding с краёв (но не больше 0.5с с одной стороны для очень коротких).
  const safeStart = Math.min(0.5, durationSec * 0.05)
  const safeEnd = Math.max(durationSec - 0.5, durationSec - durationSec * 0.05)
  const usableSpan = Math.max(0, safeEnd - safeStart)

  const equalTimestamps: number[] = []
  if (count === 1) {
    equalTimestamps.push(Math.round((durationSec / 2) * 100) / 100)
  }
  else {
    for (let i = 0; i < count; i++) {
      const t = safeStart + (usableSpan * i) / (count - 1)
      equalTimestamps.push(Math.round(t * 100) / 100)
    }
  }

  // Snap к ближайшему scene boundary в ±tolerance.
  const usedBoundaries = new Set<number>()
  const result: PickedTimestamp[] = equalTimestamps.map((t, idx) => {
    const candidate = sceneBoundaries
      .filter(b => Math.abs(b.timestampSec - t) <= tolerance)
      .filter(b => !usedBoundaries.has(b.timestampSec))
      .sort((a, b) => Math.abs(a.timestampSec - t) - Math.abs(b.timestampSec - t))[0]

    if (candidate) {
      usedBoundaries.add(candidate.timestampSec)
      return {
        sequence: idx,
        timestampSec: Math.round(candidate.timestampSec * 100) / 100,
        isSceneBoundary: true,
      }
    }
    return { sequence: idx, timestampSec: t, isSceneBoundary: false }
  })

  // Dedup + sort + reindex sequence.
  const seen = new Set<number>()
  const filtered = result.filter((r) => {
    const key = Math.round(r.timestampSec * 100)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  filtered.sort((a, b) => a.timestampSec - b.timestampSec)
  return filtered.map((r, idx) => ({ ...r, sequence: idx }))
}
