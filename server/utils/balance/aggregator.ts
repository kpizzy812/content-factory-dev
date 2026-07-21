/**
 * Параллельный fetch балансов всех сервисов с per-provider таймаутом
 * и in-memory cache (TTL 5 минут).
 *
 * Cache — простой Map, без внешних зависимостей. Singleton через globalThis
 * чтобы пережить HMR в dev.
 */

import type { ServiceBalance } from "./types"
import { getAllProviders, getProvider } from "./provider-registry"
import { computeBurnRate } from "./burn-rate"

const PROVIDER_TIMEOUT_MS = 5_000
const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  data: ServiceBalance[]
  expiresAt: number
}

const G = globalThis as typeof globalThis & { __balanceCache?: Map<string, CacheEntry> }
if (!G.__balanceCache) G.__balanceCache = new Map()

const cache = G.__balanceCache

const ALL_KEY = "__all__"

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback()), ms)),
  ])
}

export async function fetchAllBalances(opts?: { skipCache?: boolean }): Promise<ServiceBalance[]> {
  if (!opts?.skipCache) {
    const cached = cache.get(ALL_KEY)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data
    }
  }

  const providers = getAllProviders()

  const results = await Promise.all(
    providers.map(p =>
      withTimeout(p.fetchBalance(), PROVIDER_TIMEOUT_MS, () => ({
        service: p.service,
        status: "error" as const,
        source: "fallback" as const,
        checkedAt: new Date().toISOString(),
        durationMs: PROVIDER_TIMEOUT_MS,
        error: `Timeout (${PROVIDER_TIMEOUT_MS}ms)`,
      })),
    ),
  )

  // balance_v2: обогащаем metadata.burnRate параллельно. Skip для unknown/error.
  await Promise.all(
    results.map(async (b) => {
      if (b.status === "unknown" || b.status === "error") return
      const baseline = b.balance?.amount ?? null
      const burnRate = await computeBurnRate(b.service, baseline)
      b.metadata = { ...(b.metadata ?? {}), burnRate }
    }),
  )

  cache.set(ALL_KEY, { data: results, expiresAt: Date.now() + CACHE_TTL_MS })
  return results
}

export async function fetchBalance(service: string): Promise<ServiceBalance | null> {
  const provider = getProvider(service)
  if (!provider) return null
  return withTimeout(provider.fetchBalance(), PROVIDER_TIMEOUT_MS, () => ({
    service,
    status: "error" as const,
    source: "fallback" as const,
    checkedAt: new Date().toISOString(),
    durationMs: PROVIDER_TIMEOUT_MS,
    error: `Timeout (${PROVIDER_TIMEOUT_MS}ms)`,
  }))
}

/** Сбросить cache вручную (после manual edit balance) */
export function invalidateBalanceCache(): void {
  cache.clear()
}
