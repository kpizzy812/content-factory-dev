import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('content factory API contract', () => {
  it('exposes batches under the factory namespace', () => {
    expect(existsSync(new URL('../../server/api/factory/batches/index.post.ts', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../../server/api/zavod/batches/index.post.ts', import.meta.url))).toBe(false)
  })

  it('uses only official social accounts for capacity planning', () => {
    const batch = source('server/api/factory/batches/index.post.ts')
    expect(batch).toContain("postingMethod: 'api'")
    expect(batch).not.toMatch(/postingJob/i)
  })

  it('keeps funnel providers configurable', () => {
    const create = source('server/api/factory/funnels/index.post.ts')
    const list = source('server/api/factory/funnels/index.get.ts')
    expect(create).toContain('deliveryAdapter')
    expect(create).toContain('automationAdapter')
    expect(create).toContain('conversionAdapter')
    expect(`${create}\n${list}`).not.toMatch(/chatplace|reforma/i)
  })

  it('does not resolve attribution through the legacy posting job', () => {
    const event = source('server/api/factory/attribution/[trackingToken].post.ts')
    const resolver = source('server/api/factory/attribution/resolve.post.ts')
    expect(`${event}\n${resolver}`).not.toMatch(/postingJob|chatplace|reforma/i)
  })

  it('preserves an environment-blocked publication status', () => {
    const publication = source('server/utils/factory-publication.ts')
    expect(publication).toContain("if (status === 'blocked_by_env') return 'blocked'")
  })

  it('stores uploaded source clips in the presenter library', () => {
    const routes = [
      source('server/api/characters/[id]/source-clips/index.get.ts'),
      source('server/api/characters/[id]/source-clips/index.post.ts'),
      source('server/api/characters/[id]/source-clips/[clipId].delete.ts'),
    ].join('\n')
    expect(routes).toContain('prisma.presenterSourceClip')
    expect(routes).not.toContain('prisma.avatarSourceClip')
  })
})