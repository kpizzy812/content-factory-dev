/**
 * Pipeline Webhook Rate Limiter — hardened.
 *
 * Multi-layer protection:
 * - Per-pipeline token bucket (primary)
 * - Per-IP sliding window (abuse from single source)
 * - Global request counter (aggregate protection)
 * - Auto-disable after sustained abuse
 *
 * Default: 10 req/min per pipeline, 30 req/min per IP, 200 req/min global.
 * Configurable via env.
 */

const RATE_LIMIT_PIPELINE = Number(process.env.PIPELINE_WEBHOOK_RATE_LIMIT) || 10
const RATE_LIMIT_PER_IP = Number(process.env.PIPELINE_WEBHOOK_IP_RATE_LIMIT) || 30
const RATE_LIMIT_GLOBAL = Number(process.env.PIPELINE_WEBHOOK_GLOBAL_RATE_LIMIT) || 200
const WINDOW_MS = 60_000 // 1 minute
const ABUSE_THRESHOLD = 50 // errors in 10 min → auto-disable recommendation

interface BucketEntry {
  tokens: number
  lastRefill: number
}

interface IpEntry {
  requests: number[]
}

interface AbuseTracker {
  errors: number[]
}

const buckets = new Map<number, BucketEntry>()
const ipBuckets = new Map<string, IpEntry>()
const abuseTrackers = new Map<number, AbuseTracker>()

/** Global request counter (sliding window). */
let globalRequests: number[] = []

/** Clean up stale entries. */
function cleanup(): void {
  const cutoff = Date.now() - 5 * 60_000
  for (const [key, entry] of buckets) {
    if (entry.lastRefill < cutoff) buckets.delete(key)
  }
  for (const [key, entry] of ipBuckets) {
    entry.requests = entry.requests.filter(t => t > cutoff)
    if (entry.requests.length === 0) ipBuckets.delete(key)
  }
  for (const [key, tracker] of abuseTrackers) {
    tracker.errors = tracker.errors.filter(t => t > cutoff)
    if (tracker.errors.length === 0) abuseTrackers.delete(key)
  }
  globalRequests = globalRequests.filter(t => t > cutoff)
}

setInterval(cleanup, 2 * 60_000)

/**
 * Check and consume a rate limit token for a pipeline webhook.
 * Multi-layer: pipeline → IP → global.
 */
export function checkWebhookRateLimit(
  pipelineId: number,
  sourceIp?: string,
): {
  allowed: boolean
  remaining: number
  retryAfterMs?: number
  blockedBy?: 'pipeline' | 'ip' | 'global'
} {
  const now = Date.now()

  // --- Layer 1: Per-pipeline token bucket ---
  let bucket = buckets.get(pipelineId)
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_PIPELINE, lastRefill: now }
    buckets.set(pipelineId, bucket)
  }

  const elapsed = now - bucket.lastRefill
  const tokensToAdd = Math.floor((elapsed / WINDOW_MS) * RATE_LIMIT_PIPELINE)
  if (tokensToAdd > 0) {
    bucket.tokens = Math.min(RATE_LIMIT_PIPELINE, bucket.tokens + tokensToAdd)
    bucket.lastRefill = now
  }

  if (bucket.tokens <= 0) {
    const nextRefillMs = WINDOW_MS - elapsed
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(nextRefillMs, 1000),
      blockedBy: 'pipeline',
    }
  }

  // --- Layer 2: Per-IP sliding window ---
  if (sourceIp) {
    const normalizedIp = sourceIp.split(',')[0]?.trim() || sourceIp
    let ipEntry = ipBuckets.get(normalizedIp)
    if (!ipEntry) {
      ipEntry = { requests: [] }
      ipBuckets.set(normalizedIp, ipEntry)
    }

    const windowStart = now - WINDOW_MS
    ipEntry.requests = ipEntry.requests.filter(t => t > windowStart)

    if (ipEntry.requests.length >= RATE_LIMIT_PER_IP) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: WINDOW_MS,
        blockedBy: 'ip',
      }
    }

    ipEntry.requests.push(now)
  }

  // --- Layer 3: Global sliding window ---
  const globalWindowStart = now - WINDOW_MS
  globalRequests = globalRequests.filter(t => t > globalWindowStart)

  if (globalRequests.length >= RATE_LIMIT_GLOBAL) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: WINDOW_MS,
      blockedBy: 'global',
    }
  }

  globalRequests.push(now)

  // Consume pipeline token
  bucket.tokens--

  return {
    allowed: true,
    remaining: bucket.tokens,
  }
}

/** Track an error for abuse detection. */
export function trackWebhookError(pipelineId: number): void {
  let tracker = abuseTrackers.get(pipelineId)
  if (!tracker) {
    tracker = { errors: [] }
    abuseTrackers.set(pipelineId, tracker)
  }
  tracker.errors.push(Date.now())
}

/** Check if pipeline has sustained abuse pattern. */
export function checkAbuseLevel(pipelineId: number): {
  recentErrors: number
  shouldAutoDisable: boolean
} {
  const tracker = abuseTrackers.get(pipelineId)
  if (!tracker) return { recentErrors: 0, shouldAutoDisable: false }

  const tenMinAgo = Date.now() - 10 * 60_000
  const recentErrors = tracker.errors.filter(t => t > tenMinAgo).length

  return {
    recentErrors,
    shouldAutoDisable: recentErrors >= ABUSE_THRESHOLD,
  }
}

/** Get rate limit stats for a pipeline (for UI display). */
export function getWebhookRateLimitStats(pipelineId: number): {
  limit: number
  remaining: number
  windowMs: number
  ipLimit: number
  globalLimit: number
} {
  const bucket = buckets.get(pipelineId)
  return {
    limit: RATE_LIMIT_PIPELINE,
    remaining: bucket?.tokens ?? RATE_LIMIT_PIPELINE,
    windowMs: WINDOW_MS,
    ipLimit: RATE_LIMIT_PER_IP,
    globalLimit: RATE_LIMIT_GLOBAL,
  }
}
