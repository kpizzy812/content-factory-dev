import { describe, expect, it } from 'vitest'
import { evaluateFactoryQuality } from '../../server/utils/content-quality-gate'

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(' ')
}

const base = {
  stage: 'script' as const,
  hypothesis: { id: 'h1', keyword: 'PLAN', cta: 'Send PLAN' },
  funnel: { id: 'f1', status: 'active', keyword: 'PLAN' },
  leadMagnet: { id: 'l1', status: 'approved' },
  scenario: { id: 1 },
  variant: {
    id: 2,
    hook: 'Your short videos may be losing leads before the CTA',
    cta: 'Send PLAN in the comments',
    fullScript: words(180),
    storyPlan: { scenes: [] },
    qualityScore: 82,
  },
}

describe('factory quality gate', () => {
  it('passes a production-ready script', () => {
    const result = evaluateFactoryQuality(base)
    expect(result.verdict).toBe('pass')
    expect(result.estimatedDurationSec).toBe(80)
  })

  it('uses the planned scene duration for an animated 70-90 second script', () => {
    const result = evaluateFactoryQuality({
      ...base,
      variant: {
        ...base.variant,
        fullScript: words(80),
        storyPlan: {
          scenes: Array.from({ length: 9 }, () => ({ duration: '9s' })),
        },
      },
    })
    expect(result.verdict).toBe('pass')
    expect(result.estimatedDurationSec).toBe(81)
  })

  it('fails when CTA does not contain funnel keyword', () => {
    const result = evaluateFactoryQuality({
      ...base,
      variant: { ...base.variant, cta: 'Follow for updates' },
    })
    expect(result.verdict).toBe('fail')
    expect(result.issues.some(issue => issue.startsWith('cta_keyword:'))).toBe(true)
  })

  it('checks final vertical video and actual duration', () => {
    const result = evaluateFactoryQuality({
      ...base,
      stage: 'final',
      video: { status: 'completed', format: 'portrait', duration: 85 },
    })
    expect(result.verdict).toBe('pass')
  })
})
