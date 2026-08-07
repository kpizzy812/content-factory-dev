import { randomUUID } from 'node:crypto'

export type FactoryPlatform = 'instagram' | 'tiktok' | 'youtube'

export interface FactoryAccountCandidate {
  id: number
  platform: FactoryPlatform
  /** Сколько публикаций мы уже насчитали этому аккаунту за текущие сутки по своей базе. */
  currentUsage?: number
  lastPostedAt?: Date | string | null
  /** Снимок `content_publishing_limit` площадки: всего слотов за скользящие сутки. */
  quotaTotal?: number | null
  /** Тот же снимок: сколько слотов площадка уже считает израсходованными. */
  quotaUsage?: number | null
  /** Когда снят замер. Старше суток — это уже про другой день, доверять нельзя. */
  quotaCheckedAt?: Date | string | null
}

/** Откуда взят суточный лимит аккаунта: замер площадки или наш фолбэк. */
export type FactoryQuotaSource = 'platform' | 'fallback'

/** Почему пришлось взять фолбэк вместо фактической квоты. */
export type FactoryQuotaFallbackReason = 'no_snapshot' | 'stale_snapshot'

/** Разложенный по одному аккаунту лимит: что взяли, откуда и сколько осталось. */
export interface FactoryAccountLimit {
  socialAccountId: number
  platform: FactoryPlatform
  /** Суточный потолок аккаунта. */
  limit: number
  /** Израсходовано на момент планирования. */
  used: number
  /** Свободно на момент планирования. */
  free: number
  source: FactoryQuotaSource
  fallbackReason?: FactoryQuotaFallbackReason
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
  /** Аккаунты площадки, для которых фактическая квота неизвестна и взят фолбэк. */
  accountsWithoutQuota: number
}

export interface FactoryAssignmentPlan {
  ok: boolean
  items: FactoryAssignmentItem[]
  capacity: FactoryPlatformCapacity[]
  shortages: FactoryPlatformCapacity[]
  /** Лимиты всех рассмотренных аккаунтов на момент планирования — для показа оператору. */
  limits: FactoryAccountLimit[]
  /** Подмножество `limits` с неизвестной квотой: вызывающий обязан это залогировать. */
  fallbacks: FactoryAccountLimit[]
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
 * Замер квоты живёт ровно сутки: лимит Instagram катится 24 часа, поэтому
 * вчерашняя цифра описывает уже другой день.
 *
 * Порог продублирован здесь намеренно. `isLimitStale` лежит в
 * `server/utils/social/publishing-limit.ts`, а тот модуль тянет prisma —
 * импорт утащил бы клиент БД в планировщик, который обязан оставаться чистым
 * и проверяться тестом без БД.
 */
const QUOTA_SNAPSHOT_TTL_MS = 24 * 3_600_000

/** Внутреннее состояние аккаунта в пуле: `free` уменьшается по мере раскладки. */
interface PoolAccount extends FactoryAccountLimit {
  lastPostedAt: number
}

/** Число из снимка квоты: годится только конечное неотрицательное целое. */
function readQuotaNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

/**
 * Суточный потолок одного аккаунта.
 *
 * Главный источник — снимок площадки (`publishingQuotaTotal/Usage`): §3
 * PROJECT_CONTEXT требует считать по фактической квоте, а не по общему числу
 * на всех. Фолбэк оставлен ровно на два случая — замера не было вовсе или он
 * протух; оба помечаются в `fallbackReason`, чтобы вызывающий это залогировал.
 *
 * Израсходованное берём как максимум из двух счётчиков: замер площадки не
 * знает о публикациях, сделанных после него, а наш счётчик за сутки не знает о
 * публикациях мимо системы. Максимум — консервативная оценка, она не даёт
 * запланировать больше, чем реально осталось.
 */
function resolveAccountLimit(
  account: FactoryAccountCandidate,
  fallbackLimit: number,
  nowMs: number,
): PoolAccount {
  const currentUsage = Math.max(0, Math.trunc(Number(account.currentUsage ?? 0)) || 0)
  const checkedAtMs = account.quotaCheckedAt ? new Date(account.quotaCheckedAt).getTime() : Number.NaN
  const quotaTotal = readQuotaNumber(account.quotaTotal)
  const fresh = Number.isFinite(checkedAtMs) && nowMs - checkedAtMs <= QUOTA_SNAPSHOT_TTL_MS

  const base = {
    socialAccountId: account.id,
    platform: account.platform,
    lastPostedAt: account.lastPostedAt ? new Date(account.lastPostedAt).getTime() || 0 : 0,
  }

  if (quotaTotal !== null && fresh) {
    const used = Math.max(readQuotaNumber(account.quotaUsage) ?? 0, currentUsage)
    return {
      ...base,
      limit: quotaTotal,
      used,
      free: Math.max(0, quotaTotal - used),
      source: 'platform',
    }
  }

  return {
    ...base,
    limit: fallbackLimit,
    used: currentUsage,
    free: Math.max(0, fallbackLimit - currentUsage),
    source: 'fallback',
    fallbackReason: quotaTotal !== null && !fresh ? 'stale_snapshot' : 'no_snapshot',
  }
}

/**
 * Сколько аккаунтов нужно, чтобы закрыть партию.
 *
 * Квоты у аккаунтов разные, поэтому простое `count / limit` больше не годится:
 * считаем жадно от самых свободных. Если фактической ёмкости не хватает,
 * недостающее добираем по фолбэку — это оценка «сколько аккаунтов подключить».
 */
function requiredAccountsFor(freeSlots: number[], count: number, fallbackLimit: number): number {
  if (count <= 0) return 0
  let remaining = count
  let accounts = 0
  for (const free of [...freeSlots].sort((a, b) => b - a)) {
    if (remaining <= 0) break
    if (free <= 0) continue
    remaining -= free
    accounts += 1
  }
  if (remaining > 0) accounts += Math.ceil(remaining / fallbackLimit)
  return accounts
}

/**
 * Порядок выбора: сначала самый свободный аккаунт, при равенстве — тот, кто
 * дольше молчал. Балансируем по остатку, а не по израсходованному: у аккаунта
 * с квотой 100 и у аккаунта с квотой 25 одинаковое «использовано 10» означает
 * совершенно разный запас.
 */
function byFreeCapacity(a: PoolAccount, b: PoolAccount): number {
  return b.free - a.free || a.lastPostedAt - b.lastPostedAt || a.socialAccountId - b.socialAccountId
}

/**
 * Builds a deterministic, balanced account plan before any paid generation starts.
 * A batch is rejected atomically when even one requested platform lacks daily capacity.
 *
 * Раскладка идёт по фактической свободной ёмкости каждого аккаунта
 * (`quotaTotal − quotaUsage` из свежего замера площадки).
 * `dailyLimitPerAccount` остался только фолбэком на случай неизвестной квоты.
 */
export function planFactoryAssignments(input: {
  count: number
  platforms: FactoryPlatform[]
  accounts: FactoryAccountCandidate[]
  /** Фолбэк: применяется только к аккаунтам без свежего замера квоты. */
  dailyLimitPerAccount: number
  now?: Date | number
}): FactoryAssignmentPlan {
  const count = Math.max(0, Math.trunc(input.count))
  const fallbackLimit = Math.max(1, Math.trunc(input.dailyLimitPerAccount))
  const nowMs = input.now === undefined
    ? Date.now()
    : (typeof input.now === 'number' ? input.now : input.now.getTime())
  const platforms = [...new Set(input.platforms)]
  const pools = new Map<FactoryPlatform, PoolAccount[]>()
  const limits: FactoryAccountLimit[] = []

  for (const platform of platforms) {
    const seen = new Set<number>()
    const resolved = input.accounts
      .filter(account => account.platform === platform && !seen.has(account.id) && seen.add(account.id))
      .map(account => resolveAccountLimit(account, fallbackLimit, nowMs))
    // Снимок лимитов отдаём целиком, включая аккаунты с нулевым остатком:
    // оператор должен видеть, что аккаунт не взят из-за исчерпанной квоты,
    // а не потому что о нём забыли.
    limits.push(...resolved.map(account => ({
      socialAccountId: account.socialAccountId,
      platform: account.platform,
      limit: account.limit,
      used: account.used,
      free: account.free,
      source: account.source,
      ...(account.fallbackReason ? { fallbackReason: account.fallbackReason } : {}),
    })))
    pools.set(platform, resolved.filter(account => account.free > 0).sort(byFreeCapacity))
  }

  const capacity = platforms.map((platform): FactoryPlatformCapacity => {
    const pool = pools.get(platform) ?? []
    const platformLimits = limits.filter(limit => limit.platform === platform)
    return {
      platform,
      accounts: pool.length,
      requiredAccounts: requiredAccountsFor(platformLimits.map(limit => limit.free), count, fallbackLimit),
      availableSlots: pool.reduce((sum, account) => sum + account.free, 0),
      requestedSlots: count,
      accountsWithoutQuota: platformLimits.filter(limit => limit.source === 'fallback').length,
    }
  })
  const shortages = capacity.filter(item => item.availableSlots < item.requestedSlots)
  const fallbacks = limits.filter(limit => limit.source === 'fallback')

  if (shortages.length > 0) {
    return { ok: false, items: [], capacity, shortages, limits, fallbacks }
  }

  const items: FactoryAssignmentItem[] = []
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    const assignments: FactoryAssignment[] = []

    for (const platform of platforms) {
      const pool = pools.get(platform) ?? []
      const selected = [...pool].sort(byFreeCapacity).find(account => account.free > 0)

      if (!selected) {
        // Capacity was checked above; this is a defensive invariant guard.
        return {
          ok: false,
          items: [],
          capacity,
          shortages: capacity.filter(item => item.platform === platform),
          limits,
          fallbacks,
        }
      }

      selected.used += 1
      selected.free -= 1
      assignments.push({ platform, socialAccountId: selected.socialAccountId })
    }

    items.push({ ordinal, assignments })
  }

  return { ok: true, items, capacity, shortages: [], limits, fallbacks }
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
