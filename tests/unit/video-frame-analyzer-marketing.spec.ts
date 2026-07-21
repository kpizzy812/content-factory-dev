/**
 * Unit-тесты validator-а MarketingFrameAnalysis.
 *
 * AI vision-вызов не тестируем (это integration через mock-fixture);
 * здесь фокус на строгости validateMarketingFrameAnalysis: на каких полях он
 * падает с AiProviderError, какие edge cases пропускает.
 */
import { describe, expect, it } from 'vitest'
import {
  AiProviderError,
  validateMarketingFrameAnalysis,
} from '../../server/utils/agents/video-frame-analyzer-marketing'
import fixtureRaw from '../../server/__fixtures__/agents/video-frame-analyzer-marketing-happy.json'

const fixture = fixtureRaw as Record<string, unknown>

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

describe('validateMarketingFrameAnalysis — happy path', () => {
  it('happy fixture (6 кадров) проходит без ошибок', () => {
    const result = validateMarketingFrameAnalysis(fixture, 6)
    expect(result.summary.length).toBeGreaterThan(0)
    expect(result.frameDescriptions).toHaveLength(6)
    expect(result.structure.body.length).toBeGreaterThanOrEqual(2)
    expect(result.structure.body.length).toBeLessThanOrEqual(5)
    expect(result.fitScore).toBeGreaterThanOrEqual(0)
    expect(result.fitScore).toBeLessThanOrEqual(1)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.tags.length).toBeGreaterThan(0)
    expect(result.tags.every(t => typeof t.name === 'string' && t.category)).toBe(true)
  })

  it('frameDescriptions — sequence сохраняется', () => {
    const result = validateMarketingFrameAnalysis(fixture, 6)
    const sequences = result.frameDescriptions.map(fd => fd.sequence).sort((a, b) => a - b)
    expect(sequences).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('validateMarketingFrameAnalysis — strict failures', () => {
  it('output не объект → AiProviderError(malformed_output)', () => {
    expect(() => validateMarketingFrameAnalysis(null, 6)).toThrow(AiProviderError)
    expect(() => validateMarketingFrameAnalysis('string', 6)).toThrow(AiProviderError)
    expect(() => validateMarketingFrameAnalysis([1, 2, 3], 6)).toThrow(AiProviderError)
  })

  it('пустой summary → throw', () => {
    const broken = deepClone(fixture)
    broken.summary = ''
    expect(() => validateMarketingFrameAnalysis(broken, 6)).toThrow(/summary/)
  })

  it('frameDescriptions.length !== expected → throw "expected N got M"', () => {
    expect(() => validateMarketingFrameAnalysis(fixture, 5)).toThrow(/expected 5/)
    expect(() => validateMarketingFrameAnalysis(fixture, 7)).toThrow(/expected 7/)
  })

  it('missing fitScore → throw', () => {
    const broken = deepClone(fixture)
    delete broken.fitScore
    expect(() => validateMarketingFrameAnalysis(broken, 6)).toThrow(/fitScore/)
  })

  it('fitScore не число → throw', () => {
    const broken = deepClone(fixture)
    broken.fitScore = 'high' as unknown as number
    expect(() => validateMarketingFrameAnalysis(broken, 6)).toThrow(/fitScore/)
  })

  it('structure.body содержит < 2 элементов → throw', () => {
    const broken = deepClone(fixture)
    const struct = broken.structure as Record<string, unknown>
    struct.body = [{ frameSeq: 1, description: 'only one' }]
    expect(() => validateMarketingFrameAnalysis(broken, 6)).toThrow(/body/)
  })

  it('missing structure.hook → throw', () => {
    const broken = deepClone(fixture)
    const struct = broken.structure as Record<string, unknown>
    delete struct.hook
    expect(() => validateMarketingFrameAnalysis(broken, 6)).toThrow(/hook/)
  })

  it('frameDescription.sequence не number → throw', () => {
    const broken = deepClone(fixture)
    const fd = (broken.frameDescriptions as Array<Record<string, unknown>>)[0]!
    fd.sequence = 'zero'
    expect(() => validateMarketingFrameAnalysis(broken, 6)).toThrow(/sequence/)
  })
})

describe('validateMarketingFrameAnalysis — soft sanitization', () => {
  it('tag с категорией вне enum — отфильтрован', () => {
    const broken = deepClone(fixture)
    const tags = broken.tags as Array<Record<string, unknown>>
    tags.push({ category: 'made_up', name: 'should_be_dropped' })
    tags.push({ category: 'theme', name: 'kept_one' })
    const result = validateMarketingFrameAnalysis(broken, 6)
    expect(result.tags.find(t => t.name === 'should_be_dropped')).toBeUndefined()
    expect(result.tags.find(t => t.name === 'kept_one')).toBeDefined()
  })

  it('hook.evaluation вне enum → fallback "weak"', () => {
    const broken = deepClone(fixture)
    const struct = broken.structure as Record<string, unknown>
    const hook = struct.hook as Record<string, unknown>
    hook.evaluation = 'amazing'
    const result = validateMarketingFrameAnalysis(broken, 6)
    expect(result.structure.hook.evaluation).toBe('weak')
  })

  it('fitScore > 1 → clamp до 1', () => {
    const broken = deepClone(fixture)
    broken.fitScore = 1.5
    const result = validateMarketingFrameAnalysis(broken, 6)
    expect(result.fitScore).toBe(1)
  })

  it('fitScore < 0 → clamp до 0', () => {
    const broken = deepClone(fixture)
    broken.fitScore = -0.3
    const result = validateMarketingFrameAnalysis(broken, 6)
    expect(result.fitScore).toBe(0)
  })

  it('cta.present=false / frameSeq=null валидно', () => {
    const broken = deepClone(fixture)
    const struct = broken.structure as Record<string, unknown>
    struct.cta = { present: false, frameSeq: null, description: '' }
    const result = validateMarketingFrameAnalysis(broken, 6)
    expect(result.structure.cta.present).toBe(false)
    expect(result.structure.cta.frameSeq).toBeNull()
  })

  it('keyElements как array строк сохраняется', () => {
    const result = validateMarketingFrameAnalysis(fixture, 6)
    const fd = result.frameDescriptions[0]!
    expect(Array.isArray(fd.keyElements)).toBe(true)
  })

  it('audience пустая строка → null', () => {
    const broken = deepClone(fixture)
    broken.audience = '   '
    const result = validateMarketingFrameAnalysis(broken, 6)
    expect(result.audience).toBeNull()
  })
})
