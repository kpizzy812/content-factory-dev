import { describe, expect, it } from 'vitest'
import {
  createFactoryTrackingToken,
  inspectFactoryPipeline,
  planFactoryAssignments,
  readFactoryContext,
} from '../../server/utils/content-factory-batch'

describe('content factory batch planning', () => {
  it('plans 300 daily Instagram publications across six 50-slot accounts', () => {
    const result = planFactoryAssignments({
      count: 300,
      platforms: ['instagram'],
      dailyLimitPerAccount: 50,
      accounts: Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        platform: 'instagram' as const,
      })),
    })

    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(300)
    const counts = new Map<number, number>()
    for (const item of result.items) {
      const id = item.assignments[0]!.socialAccountId
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect([...counts.values()]).toEqual([50, 50, 50, 50, 50, 50])
    expect(result.capacity[0]?.requiredAccounts).toBe(6)
  })

  it('rejects a batch before generation when account capacity is insufficient', () => {
    const result = planFactoryAssignments({
      count: 300,
      platforms: ['instagram'],
      dailyLimitPerAccount: 50,
      accounts: [{ id: 1, platform: 'instagram' }],
    })

    expect(result.ok).toBe(false)
    expect(result.items).toEqual([])
    expect(result.shortages[0]).toMatchObject({ availableSlots: 50, requestedSlots: 300 })
  })

  it('respects already used daily slots and plans every requested platform', () => {
    const result = planFactoryAssignments({
      count: 2,
      platforms: ['instagram', 'tiktok'],
      dailyLimitPerAccount: 3,
      accounts: [
        { id: 1, platform: 'instagram', currentUsage: 2 },
        { id: 2, platform: 'instagram' },
        { id: 3, platform: 'tiktok', currentUsage: 1 },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(2)
    expect(result.items.every(item => item.assignments.length === 2)).toBe(true)
    expect(result.items.map(item => item.assignments[0]?.socialAccountId)).toEqual([2, 2])
  })

  it('creates unique attribution tokens and parses protected factory context', () => {
    const first = createFactoryTrackingToken(7, 1)
    const second = createFactoryTrackingToken(7, 1)
    expect(first).toMatch(/^cf_7_1_[a-f0-9]{32}$/)
    expect(second).not.toBe(first)

    expect(readFactoryContext({
      _factory: {
        cycleId: 7,
        trackingToken: first,
        keyword: 'PLAN',
        assignments: [{ platform: 'instagram', socialAccountId: 11 }],
      },
    })).toEqual({
      cycleId: 7,
      trackingToken: first,
      keyword: 'PLAN',
      assignments: [{ platform: 'instagram', socialAccountId: 11 }],
    })
  })

  it('detects safeguards explicitly enabled by a factory pipeline', () => {
    const result = inspectFactoryPipeline({
      nodes: [
        { data: { type: 'content_strategy', config: {} } },
        {
          data: {
            type: 'quality_gate',
            config: {
              stage: 'script',
              requireFunnel: true,
              requireApprovedLeadMagnet: true,
            },
          },
        },
        { data: { type: 'quality_gate', config: { stage: 'final' } } },
      ],
    })

    expect(result).toEqual({
      hasContentStrategy: true,
      hasScriptQualityGate: true,
      hasFinalQualityGate: true,
      requiresFunnel: true,
      requiresApprovedLeadMagnet: true,
    })
  })

  it('does not invent funnel requirements for ordinary quality gates', () => {
    const result = inspectFactoryPipeline({
      nodes: [
        { data: { type: 'quality_gate', config: { stage: 'script' } } },
      ],
    })

    expect(result.requiresFunnel).toBe(false)
    expect(result.requiresApprovedLeadMagnet).toBe(false)
  })
})
