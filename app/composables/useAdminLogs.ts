import type { AdminLogsResponse } from '~~/shared/types/admin-log'

/**
 * Загрузка унифицированной ленты журналов для /admin/logs.
 * Ответ объединяет 8 источников (agent, app_enrichment, secret_access,
 * telegram_command, trendwatcher_run, webhook, ai_audit, posting_job).
 */
export function useAdminLogs(query: MaybeRefOrGetter<Record<string, unknown>>) {
  return useFetch<AdminLogsResponse>('/api/admin/logs', {
    key: 'admin-logs',
    query,
    watch: [query],
  })
}
