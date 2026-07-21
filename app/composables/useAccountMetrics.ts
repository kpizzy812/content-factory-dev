/**
 * Composable для управления метриками аккаунта (Apify Account Metrics, Часть C).
 *
 * Используется AccountMetricsTab. Реактивно держит:
 *   - snapshots: история снимков (limit=30, DESC по fetchedAt)
 *   - platform/platformHandle: контекст для UI
 *   - loading: первичная/повторная загрузка списка
 *   - fetching: запущен fetchNow (Apify scrape)
 *   - error: AccountDiagnosticError для AccountDiagnosticPanel
 *
 * fetchNow:
 *   - skipped=true → 24h cache hit, не вызывает Apify
 *   - { force: true } → форс-refetch
 *   - после успеха автоматически refresh'ит list с includeRaw=true
 */
import {
  toDiagnosticError,
  type AccountDiagnosticError,
} from "~~/shared/types/account-diagnostic"
import type {
  AccountMetricsResponse,
  AccountMetricsFetchResponse,
  AccountMetricsSnapshotDTO,
} from "~~/shared/types/account-metrics"

export function useAccountMetrics(accountId: Ref<number | null>) {
  const snapshots = ref<AccountMetricsSnapshotDTO[]>([])
  const total = ref(0)
  const platform = ref<string | null>(null)
  const platformHandle = ref<string | null>(null)
  const loading = ref(false)
  const fetching = ref(false)
  const error = ref<AccountDiagnosticError | null>(null)

  async function load(opts: { includeRaw?: boolean } = {}): Promise<void> {
    if (!accountId.value) return
    loading.value = true
    error.value = null
    try {
      const url = `/api/accounts/${accountId.value}/metrics`
      const query: Record<string, string> = { limit: "30" }
      if (opts.includeRaw) query.includeRaw = "1"
      const res = await $fetch<AccountMetricsResponse>(url, { query })
      snapshots.value = res.data.snapshots
      total.value = res.data.total
      platform.value = res.data.platform
      platformHandle.value = res.data.platformHandle
    } catch (e) {
      error.value = toDiagnosticError(e, {
        phase: "metrics_load",
        url: `/api/accounts/${accountId.value}/metrics`,
      })
    } finally {
      loading.value = false
    }
  }

  async function fetchNow(
    opts: { force?: boolean } = {},
  ): Promise<AccountMetricsFetchResponse["data"] | null> {
    if (!accountId.value) return null
    fetching.value = true
    error.value = null
    try {
      const url = `/api/accounts/${accountId.value}/metrics/fetch`
      const query: Record<string, string> = {}
      if (opts.force) query.force = "1"
      const res = await $fetch<AccountMetricsFetchResponse>(url, {
        method: "POST",
        query,
      })
      // После успешного fetch обновляем list с rawData чтобы UI получил posts
      await load({ includeRaw: true })
      return res.data
    } catch (e) {
      error.value = toDiagnosticError(e, {
        phase: "metrics_fetch",
        url: `/api/accounts/${accountId.value}/metrics/fetch`,
      })
      return null
    } finally {
      fetching.value = false
    }
  }

  return {
    snapshots,
    total,
    platform,
    platformHandle,
    loading,
    fetching,
    error,
    load,
    fetchNow,
  }
}
