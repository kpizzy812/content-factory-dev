import { describe, expect, it } from 'vitest'
import {
  contentHypothesisFingerprint,
  validateContentStrategyResult,
} from '../../server/utils/agents/content-strategy-agent'

const valid = {
  title: 'How to improve a short-form content funnel',
  angle: 'Explain the most common mistake and how to fix it',
  audience: 'Creators who publish short videos every day',
  problem: 'Their videos get views but produce no leads',
  promise: 'A simple structure for turning attention into demand',
  hook: 'Your short videos may be losing leads before the CTA',
  cta: 'Send PLAN in the comments',
  keyword: 'PLAN',
  proofPoints: ['The method connects each video to one measurable action'],
  rationale: 'The angle matches the audience problem and has a clear conversion path',
  leadMagnet: {
    title: 'Content funnel checklist',
    format: 'checklist',
    problem: 'Videos do not convert viewers',
    audience: 'creators',
    sections: [
      { title: 'Step 1', content: 'Choose one audience problem.' },
      { title: 'Step 2', content: 'Connect one CTA.' },
    ],
    deliveryMessage: 'Here is your checklist.',
    warmupMessages: [{ delayHours: 24, text: 'How is the checklist working?' }],
  },
}

describe('content strategy result', () => {
  it('validates a complete strategy', () => {
    expect(validateContentStrategyResult(valid).keyword).toBe('PLAN')
  })

  it('rejects a multi-word keyword', () => {
    expect(() => validateContentStrategyResult({ ...valid, keyword: 'MY PLAN' })).toThrow(/keyword/)
  })

  it('creates stable content fingerprints', () => {
    const a = contentHypothesisFingerprint(valid)
    const b = contentHypothesisFingerprint({
      angle: `  ${valid.angle.toUpperCase()} `,
      hook: valid.hook,
      cta: valid.cta,
    })
    expect(a).toBe(b)
  })
})
