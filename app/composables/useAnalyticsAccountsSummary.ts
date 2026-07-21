import type {
  AccountsSummaryFilters,
  AccountsSummaryResponse,
} from "~~/shared/types/analytics"

/**
 * Реактивный fetch /api/analytics/accounts-summary.
 * Используется на /analytics в табе «Аккаунты» (Apify Account Metrics).
 *
 * Не путать с useAnalyticsDashboard (per-post метрики через Upload.PostMetrics)
 * и useAccountMetrics (одиночный аккаунт в табе «Статистика» AccountEditModal).
 * Здесь — агрегат по всем аккаунтам в выборке.
 */
export function useAnalyticsAccountsSummary(
  query: MaybeRefOrGetter<AccountsSummaryFilters>,
) {
  // useFetch уже следит за реактивными query через опцию `query` —
  // дублирующий watch:[query] создавал двойной запрос.
  return useFetch<AccountsSummaryResponse>(
    "/api/analytics/accounts-summary",
    { query },
  )
}
