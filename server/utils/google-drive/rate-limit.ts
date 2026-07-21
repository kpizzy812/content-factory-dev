/**
 * In-memory rate limiters for Drive operations.
 *
 * Per-user: 30 ops / 60s sliding window — для download/sync (heavy operations).
 * Global: 100 req / 60s — для test-drive (защита от ботов на shared endpoint).
 *
 * Single-process. При horizontal scale заменить на Redis/Postgres backend.
 */

const USER_LIMIT = 30
const USER_WINDOW_MS = 60_000
const GLOBAL_LIMIT = 100
const GLOBAL_WINDOW_MS = 60_000

const userBuckets = new Map<number, number[]>()
const globalBucket: number[] = []

export interface RateLimitDecision {
  ok: boolean
  retryAfterSec?: number
  remaining?: number
}

function consumeBucket(
  bucket: number[],
  limit: number,
  windowMs: number,
  now: number,
): RateLimitDecision {
  const cutoff = now - windowMs
  let writeIndex = 0
  for (let i = 0; i < bucket.length; i += 1) {
    const ts = bucket[i] as number
    if (ts > cutoff) {
      bucket[writeIndex] = ts
      writeIndex += 1
    }
  }
  bucket.length = writeIndex

  if (bucket.length >= limit) {
    const oldest = bucket[0] ?? now
    const retryMs = Math.max(0, windowMs - (now - oldest))
    return { ok: false, retryAfterSec: Math.ceil(retryMs / 1000) }
  }
  bucket.push(now)
  return { ok: true, remaining: Math.max(0, limit - bucket.length) }
}

export function checkUserRateLimit(userId: number): RateLimitDecision {
  if (!Number.isFinite(userId) || userId <= 0) {
    return { ok: true, remaining: USER_LIMIT }
  }
  const bucket = userBuckets.get(userId) ?? []
  const decision = consumeBucket(bucket, USER_LIMIT, USER_WINDOW_MS, Date.now())
  userBuckets.set(userId, bucket)
  return decision
}

export function checkGlobalRateLimit(): RateLimitDecision {
  return consumeBucket(globalBucket, GLOBAL_LIMIT, GLOBAL_WINDOW_MS, Date.now())
}

export function _resetDriveRateLimits(): void {
  userBuckets.clear()
  globalBucket.length = 0
}
