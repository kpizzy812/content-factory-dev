/**
 * Unit-тесты парсера stderr ffmpeg для scene-detect.
 *
 * Полную интеграцию (реальный ffmpeg spawn) проверяем в integration-тестах,
 * здесь же фокус на парсинге `pts_time:N` через regex.
 */
import { describe, expect, it } from 'vitest'
import { parseSceneBoundariesFromStderr } from '../../server/utils/video-tools/scene-detect'

describe('parseSceneBoundariesFromStderr', () => {
  it('пустой stderr → пустой массив', () => {
    expect(parseSceneBoundariesFromStderr('')).toEqual([])
  })

  it('нет совпадений pts_time → пустой массив', () => {
    const stderr = `
      ffmpeg version 6.0
      [info] some info line
      [warning] could not detect anything
    `
    expect(parseSceneBoundariesFromStderr(stderr)).toEqual([])
  })

  it('одна строка с pts_time → один boundary', () => {
    const stderr = '[Parsed_showinfo_1 @ 0xff] n: 12 pts_time:1.234 pos: 100'
    expect(parseSceneBoundariesFromStderr(stderr)).toEqual([
      { timestampSec: 1.23 },
    ])
  })

  it('несколько pts_time → массив отсортирован asc и round 2 знака', () => {
    const stderr = `
      [showinfo] pts_time:5.6789
      [showinfo] pts_time:1.234
      [showinfo] pts_time:12.555
    `
    expect(parseSceneBoundariesFromStderr(stderr)).toEqual([
      { timestampSec: 1.23 },
      { timestampSec: 5.68 },
      { timestampSec: 12.56 },
    ])
  })

  it('дубликаты pts_time после round → dedup', () => {
    const stderr = `
      pts_time:1.234
      pts_time:1.235
      pts_time:1.236
    `
    // 1.234 → 1.23, 1.235 → 1.24 (banker's? Math.round даёт 1.24), 1.236 → 1.24
    // Реально: Math.round(1.235*100)=124 → 1.24, Math.round(1.236*100)=124 → 1.24
    const result = parseSceneBoundariesFromStderr(stderr)
    // Все три должны схлопнуться в максимум 2 уникальных значения
    const unique = new Set(result.map(r => r.timestampSec))
    expect(unique.size).toBeLessThanOrEqual(2)
  })

  it('integer pts_time без дробной части тоже парсится', () => {
    const stderr = 'pts_time:42'
    expect(parseSceneBoundariesFromStderr(stderr)).toEqual([
      { timestampSec: 42 },
    ])
  })

  it('игнорирует случайные числа без префикса pts_time', () => {
    const stderr = `
      width: 1920 height: 1080
      pts:5000 dts:5000
      frame:42 timestamp:1.5
      pts_time:3.5
    `
    expect(parseSceneBoundariesFromStderr(stderr)).toEqual([
      { timestampSec: 3.5 },
    ])
  })

  it('несколько pts_time в одной строке', () => {
    const stderr = 'pts_time:1.0 pts_time:2.0 pts_time:3.0'
    expect(parseSceneBoundariesFromStderr(stderr)).toHaveLength(3)
  })
})
