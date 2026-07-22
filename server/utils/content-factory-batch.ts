import { randomUUID } from 'node:crypto'

export type FactoryPlatform = 'instagram' | 'tiktok' | 'youtube'

export interface FactoryAccountCandidate {
  id: number
  platform: FactoryPlatform
  currentUsage?: number
  lastPostedAt?: Date | string | null
}

export interface FactoryAssignment {
  platform: FactoryPlatform
  socialAccountId: number
}

export interface FactoryAssignmentItem {
  ordinal: number
  assignments: FactoryAssignment[]
}

export interface FactoryPlatformCapacity {
  platform: FactoryPlatform
  accounts: number
  requiredAccounts: number
  availableSlots: number
  requestedSlots: number
}

export interface FactoryAssignmentPlan {
  ok: boolean
  items: FactoryAssignmentItem[]
  capacity: FactoryPlatformCapacity[]
  shortages: FactoryPlatformCapacity[]
}

export interface FactoryPipelineRequirements {
  hasContentStrategy: boolean
  hasScriptQualityGate: boolean
  hasFinalQualityGate: boolean
  requiresFunnel: boolean
  requiresApprovedLeadMagnet: boolean
}

/** Reads safeguards declared by a pipeline before a paid factory batch is created. */
export function inspectFactoryPipeline(graphData: unknown): FactoryPipelineRequirements {
  const graph = graphData && typeof graphData === 'object' && !Array.isArray(graphData)
    ? graphData as { nodes?: unknown[] }
    : null
  const nodes = Array.isArray(graph?.nodes)
    ? graph.nodes.filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === 'object' && !Array.isArray(node))
    : []
  const descriptors = nodes.map((node) => {
    const data = node.data && typeof node.data === 'object' && !Array.isArray(node.data)
      ? node.data as Record<string, unknown>
      : {}
    const config = data.config && typeof data.config === 'object' && !Array.isArray(data.config)
      ? data.config as Record<string, unknown>
      : {}
    return { type: String(data.type ?? ''), config }
  })
  const qualityGates = descriptors.filter(node => node.type === 'quality_gate')
  return {
    hasContentStrategy: descriptors.some(node => node.type === 'content_strategy'),
    hasScriptQualityGate: qualityGates.some(node => node.config.stage !== 'final'),
    hasFinalQualityGate: qualityGates.some(node => node.config.stage === 'final'),
    requiresFunnel: qualityGates.some(node => node.config.requireFunnel === true),
    requiresApprovedLeadMagnet: qualityGates.some(node => node.config.requireApprovedLeadMagnet === true),
  }
}

/**
 * Builds a deterministic, balanced account plan before any paid generation starts.
 * A batch is rejected atomically when even one requested platform lacks daily capacity.
 */
export function planFactoryAssignments(input: {
  count: number
  platforms: FactoryPlatform[]
  accounts: FactoryAccountCandidate[]
  dailyLimitPerAccount: number
}): FactoryAssignmentPlan {
  const count = Math.max(0, Math.trunc(input.count))
  const dailyLimit = Math.max(1, Math.trunc(input.dailyLimitPerAccount))
  const platforms = [...new Set(input.platforms)]
  const pools = new Map<FactoryPlatform, Array<{
    id: number
    used: number
    lastPostedAt: number
  }>>()

  for (const platform of platforms) {
    const seen = new Set<number>()
    const pool = input.accounts
      .filter(account => account.platform === platform && !seen.has(account.id) && seen.add(account.id))
      .map(account => ({
        id: account.id,
        used: Math.max(0, Math.trunc(account.currentUsage ?? 0)),
        lastPostedAt: account.lastPostedAt ? new Date(account.lastPostedAt).getTime() : 0,
      }))
      .filter(account => account.used < dailyLimit)
      .sort((a, b) => a.used - b.used || a.lastPostedAt - b.lastPostedAt || a.id - b.id)
    pools.set(platform, pool)
  }

  const capacity = platforms.map((platform): FactoryPlatformCapacity => {
    const pool = pools.get(platform) ?? []
    return {
      platform,
      accounts: pool.length,
      requiredAccounts: Math.ceil(count / dailyLimit),
      availableSlots: pool.reduce((sum, account) => sum + Math.max(0, dailyLimit - account.used), 0),
      requestedSlots: count,
    }
  })
  const shortages = capacity.filter(item => item.availableSlots < item.requestedSlots)

  if (shortages.length > 0) {
    return { ok: false, items: [], capacity, shortages }
  }

  const items: FactoryAssignmentItem[] = []
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    const assignments: FactoryAssignment[] = []

    for (const platform of platforms) {
      const pool = pools.get(platform) ?? []
      const selected = pool
        .filter(account => account.used < dailyLimit)
        .sort((a, b) => a.used - b.used || a.lastPostedAt - b.lastPostedAt || a.id - b.id)[0]

      if (!selected) {
        // Capacity was checked above; this is a defensive invariant guard.
        return { ok: false, items: [], capacity, shortages: capacity.filter(c => c.platform === platform) }
      }

      selected.used++
      assignments.push({ platform, socialAccountId: selected.id })
    }

    items.push({ ordinal, assignments })
  }

  return { ok: true, items, capacity, shortages: [] }
}

export function createFactoryTrackingToken(cycleId: number, ordinal: number): string {
  const nonce = randomUUID().replaceAll('-', '')
  return `cf_${cycleId}_${ordinal}_${nonce}`
}

export function readFactoryContext(input: Record<string, unknown>): {
  cycleId?: number
  ordinal?: number
  trackingToken?: string
  keyword?: string
  funnelId?: string
  leadMagnetId?: string
  assignments: FactoryAssignment[]
} | null {
  const raw = input._factory
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const assignments = Array.isArray(value.assignments)
    ? value.assignments.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const candidate = item as Record<string, unknown>
        const platform = String(candidate.platform) as FactoryPlatform
        const socialAccountId = Number(candidate.socialAccountId)
        if (!['instagram', 'tiktok', 'youtube'].includes(platform) || !Number.isInteger(socialAccountId) || socialAccountId <= 0) return []
        return [{ platform, socialAccountId }]
      })
    : []

  return {
    cycleId: Number(value.cycleId) || undefined,
    ordinal: Number(value.ordinal) || undefined,
    trackingToken: typeof value.trackingToken === 'string' ? value.trackingToken : undefined,
    keyword: typeof value.keyword === 'string' ? value.keyword : undefined,
    funnelId: typeof value.funnelId === 'string' ? value.funnelId : undefined,
    leadMagnetId: typeof value.leadMagnetId === 'string' ? value.leadMagnetId : undefined,
    assignments,
  }
}
