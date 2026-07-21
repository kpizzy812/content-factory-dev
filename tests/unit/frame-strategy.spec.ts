/**
 * Unit-тесты для frame-strategy: adaptive count и pickTimestamps с scene-snap.
 * Чистая логика, не лезет ни в БД, ни в ffmpeg.
 */
import { describe, expect, it } from 'vitest'
import {
  frameCountForDuration,
  pickTimestamps,
} from '../../server/utils/video-tools/frame-strategy'

describe('frameCountForDuration', () => {
  it('5s → 6 кадров (нижняя граница)', () => {
    expect(frameCountForDuration(5)).toBe(6)
  })

  it('15s → 6 (включительно ≤15)', () => {
    expect(frameCountForDuration(15)).toBe(6)
  })

  it('16s → 8', () => {
    expect(frameCountForDuration(16)).toBe(8)
  })

  it('30s → 8', () => {
    expect(frameCountForDuration(30)).toBe(8)
  })

  it('31s → 10', () => {
    expect(frameCountForDuration(31)).toBe(10)
  })

  it('60s → 10', () => {
    expect(frameCountForDuration(60)).toBe(10)
  })

  it('61s → 12', () => {
    expect(frameCountForDuration(61)).toBe(12)
  })

  it('120s → 12', () => {
    expect(frameCountForDuration(120)).toBe(12)
  })

  it('121s → 15', () => {
    expect(frameCountForDuration(121)).toBe(15)
  })

  it('600s → 15 (потолок)', () => {
    expect(frameCountForDuration(600)).toBe(15)
  })
})

describe('pickTimestamps — без scene boundaries', () => {
  it('durationSec=0 → пустой массив', () => {
    expect(pickTimestamps(0)).toEqual([])
  })

  it('60s без сцен → 10 timestamps с padding (min 0.5s по краям)', () => {
    const result = pickTimestamps(60, [])
    expect(result).toHaveLength(10)
    // safeStart = min(0.5, 60*0.05=3) = 0.5
    // safeEnd = max(60-0.5=59.5, 60-3=57) = 59.5
    // span = 59 / 9 = ~6.56
    expect(result[0]?.timestampSec).toBeCloseTo(0.5, 1)
    expect(result[9]?.timestampSec).toBeCloseTo(59.5, 1)
    expect(result.every(r => r.isSceneBoundary === false)).toBe(true)
    expect(result.map(r => r.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('кастомный count=3 → 3 timestamps', () => {
    const result = pickTimestamps(60, [], { count: 3 })
    expect(result).toHaveLength(3)
  })

  it('count=1 → один timestamp в середине', () => {
    const result = pickTimestamps(60, [], { count: 1 })
    expect(result).toHaveLength(1)
    expect(result[0]?.timestampSec).toBeCloseTo(30, 1)
  })

  it('15s видео → 6 кадров (по умолчанию)', () => {
    const result = pickTimestamps(15)
    expect(result).toHaveLength(6)
  })
})

describe('pickTimestamps — со scene snap', () => {
  it('snap на ближайшую границу в пределах tolerance', () => {
    // 60s, count=10, safeStart=0.5, safeEnd=59.5
    // равномерные: 0.5, 7.06, 13.61, 20.17, 26.72, 33.28, 39.83, 46.39, 52.94, 59.5
    // boundary 26 близок к 26.72 (расстояние 0.72) — snap сработает
    // boundary 13.5 близок к 13.61 (расстояние 0.11) — snap сработает
    // boundary 100 вне видео — игнор
    const result = pickTimestamps(60, [
      { timestampSec: 13.5 },
      { timestampSec: 26 },
      { timestampSec: 100 },
    ])
    expect(result).toHaveLength(10)
    const flagged = result.filter(r => r.isSceneBoundary)
    expect(flagged.length).toBeGreaterThanOrEqual(2)
    expect(result.some(r => r.timestampSec === 13.5 && r.isSceneBoundary)).toBe(true)
    expect(result.some(r => r.timestampSec === 26 && r.isSceneBoundary)).toBe(true)
  })

  it('один boundary не используется дважды (usedBoundaries Set)', () => {
    // 60s, count=10 — равномерные 26.72 и 33.28, boundary 30 равноудалён ~3.28
    // С tolerance=5 оба попадают в окно — но только один snap, второй revert
    const result = pickTimestamps(60, [{ timestampSec: 30 }], { tolerance: 5 })
    const snappedToThirty = result.filter(
      r => r.isSceneBoundary && r.timestampSec === 30,
    )
    // Только одна точка может быть snapped на 30
    expect(snappedToThirty.length).toBe(1)
  })

  it('кастомный tolerance расширяет окно snap', () => {
    // boundary 10, равномерная точка ≈ 3, расстояние 7 — больше default tolerance=2
    // но с tolerance=10 должна snapнуться
    const noSnap = pickTimestamps(60, [{ timestampSec: 10 }])
    const expanded = pickTimestamps(60, [{ timestampSec: 10 }], { tolerance: 10 })
    const noSnapHas10 = noSnap.some(r => r.timestampSec === 10 && r.isSceneBoundary)
    const expandedHas10 = expanded.some(r => r.timestampSec === 10 && r.isSceneBoundary)
    expect(noSnapHas10).toBe(false)
    expect(expandedHas10).toBe(true)
  })

  it('boundaries вне видео игнорируются', () => {
    const result = pickTimestamps(60, [{ timestampSec: 999 }])
    expect(result.every(r => !r.isSceneBoundary)).toBe(true)
  })

  it('после snap результат отсортирован по timestampSec', () => {
    const result = pickTimestamps(60, [
      { timestampSec: 5 },
      { timestampSec: 25 },
      { timestampSec: 50 },
    ])
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]?.timestampSec
      const curr = result[i]?.timestampSec
      expect(curr ?? 0).toBeGreaterThan(prev ?? -1)
    }
  })

  it('sequence реиндексируется после dedup и sort', () => {
    const result = pickTimestamps(60, [{ timestampSec: 30 }])
    expect(result.map(r => r.sequence)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
  })
})
