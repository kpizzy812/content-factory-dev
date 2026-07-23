import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8')

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, 'm'))
  if (!match) throw new Error(`Model ${name} is missing`)
  return match[1]
}

describe('content factory database contract', () => {
  it('stores reusable presenter clips independently from rendered videos', () => {
    const sourceClip = model('PresenterSourceClip')
    expect(sourceClip).toContain('characterId')
    expect(sourceClip).toContain('durationSec')
    expect(sourceClip).toContain('usageCount')
  })

  it('keeps funnel integrations behind adapter configuration', () => {
    const funnel = model('ContentFunnel')
    expect(funnel).toContain('deliveryAdapter')
    expect(funnel).toContain('automationAdapter')
    expect(funnel).toContain('conversionAdapter')
    expect(funnel).toContain('conversionTrackingParam')
    expect(funnel).toContain('webhookSecretEncrypted')
    expect(funnel).not.toMatch(/chatplace|reforma/i)
  })

  it('persists one tracking token through hypothesis, publication and events', () => {
    expect(model('ContentHypothesis')).toContain('trackingToken')
    expect(model('FactoryPublication')).toContain('trackingToken')
    expect(model('AttributionEvent')).toContain('trackingToken')
  })

  it('tracks provider-neutral automation sync state on a publication', () => {
    const publication = model('FactoryPublication')
    expect(publication).toContain('automationStatus')
    expect(publication).toContain('automationExternalId')
    expect(publication).toContain('automationError')
    expect(publication).toContain('automationAttempts')
    expect(publication).toContain('automationSnapshot')
    expect(publication).not.toMatch(/chatplace|reforma/i)
  })

  it('does not couple factory publications to the legacy posting job', () => {
    expect(model('FactoryPublication')).not.toContain('PostingJob')
    expect(model('FactoryPublication')).not.toContain('postingJobId')
  })
})