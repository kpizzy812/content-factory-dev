import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// process.cwd(), а не import.meta.url: под happy-dom из основного vitest-конфига
// import.meta.url не является file:-URL, и проверки существования файлов врут.
function repoPath(path: string): string {
  return resolve(process.cwd(), path)
}

function source(path: string): string {
  return readFileSync(repoPath(path), 'utf8')
}

describe('content factory API contract', () => {
  it('exposes batches under the factory namespace', () => {
    expect(existsSync(repoPath('server/api/factory/batches/index.post.ts'))).toBe(true)
    expect(existsSync(repoPath('server/api/zavod/batches/index.post.ts'))).toBe(false)
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

  it('uses an official MCP adapter for the provider-specific ChatPlace integration', () => {
    const adapter = source('server/utils/factory-automation/chatplace-mcp.ts')
    const status = source('server/api/factory/integrations/chatplace/status.get.ts')
    expect(adapter).toContain('createMcpClient')
    expect(adapter).toContain('listTools')
    expect(adapter).toContain('callTool')
    expect(status).toContain('discoverChatPlaceTools')
    expect(`${adapter}\n${status}`).not.toMatch(/adb|appium|private.?api/i)
  })

  it('exposes automation state in existing batch status', () => {
    const batch = source('server/api/factory/batches/[id].get.ts')
    expect(batch).toContain('automationStatus')
    expect(batch).toContain('automationExternalId')
    expect(batch).toContain('automationAttempts')
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