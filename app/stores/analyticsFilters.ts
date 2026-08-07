import type { AnalyticsFilters } from '#shared/types/analytics'
import type { AnalyticsPeriodPreset } from '#shared/types/analytics-funnel'

export const useAnalyticsFiltersStore = defineStore('analyticsFilters', () => {
  const platform = ref<AnalyticsFilters['platform'] | ''>('')
  /**
   * Окно сквозной аналитики. Отдельно от `dateFrom`/`dateTo`: пресет живёт в
   * запросе как `period`, а произвольный период — как две даты, и сервер
   * различает их сам.
   */
  const period = ref<AnalyticsPeriodPreset>('7d')
  const socialAccountId = ref<number | undefined>(undefined)
  const appId = ref<number | undefined>(undefined)
  const runId = ref<number | undefined>(undefined)
  const pipelineId = ref<number | undefined>(undefined)
  const dateFrom = ref<string>('')
  const dateTo = ref<string>('')
  const sortBy = ref<AnalyticsFilters['sortBy']>('createdAt')
  const sortOrder = ref<AnalyticsFilters['sortOrder']>('desc')
  const page = ref<number>(1)
  const perPage = ref<number>(20)

  const query = computed(() => ({
    ...(platform.value ? { platform: platform.value } : {}),
    ...(socialAccountId.value ? { socialAccountId: socialAccountId.value } : {}),
    ...(appId.value ? { appId: appId.value } : {}),
    ...(runId.value ? { runId: runId.value } : {}),
    ...(pipelineId.value ? { pipelineId: pipelineId.value } : {}),
    ...(dateFrom.value ? { dateFrom: dateFrom.value } : {}),
    ...(dateTo.value ? { dateTo: dateTo.value } : {}),
    sortBy: sortBy.value,
    sortOrder: sortOrder.value,
    page: page.value,
    perPage: perPage.value,
  }))

  const dashboardQuery = computed(() => ({
    ...(appId.value ? { appId: appId.value } : {}),
    ...(runId.value ? { runId: runId.value } : {}),
    ...(pipelineId.value ? { pipelineId: pipelineId.value } : {}),
    ...(dateFrom.value ? { dateFrom: dateFrom.value } : {}),
    ...(dateTo.value ? { dateTo: dateTo.value } : {}),
  }))

  /**
   * Отбор сквозной аналитики: воронка, рейтинги и динамика обязаны смотреть
   * на одно и то же окно, поэтому запрос у них общий.
   */
  const scopeQuery = computed(() => ({
    ...(period.value === 'custom'
      ? {
          ...(dateFrom.value ? { dateFrom: dateFrom.value } : {}),
          ...(dateTo.value ? { dateTo: dateTo.value } : {}),
        }
      : { period: period.value }),
    ...(appId.value ? { appId: appId.value } : {}),
    ...(platform.value ? { platform: platform.value } : {}),
    ...(socialAccountId.value ? { socialAccountId: socialAccountId.value } : {}),
    ...(pipelineId.value ? { pipelineId: pipelineId.value } : {}),
    ...(runId.value ? { runId: runId.value } : {}),
  }))

  function resetFilters() {
    platform.value = ''
    period.value = '7d'
    socialAccountId.value = undefined
    appId.value = undefined
    runId.value = undefined
    pipelineId.value = undefined
    dateFrom.value = ''
    dateTo.value = ''
    sortBy.value = 'createdAt'
    sortOrder.value = 'desc'
    page.value = 1
  }

  function resetPage() {
    page.value = 1
  }

  function toggleSort(field: NonNullable<AnalyticsFilters['sortBy']>) {
    if (sortBy.value === field) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortBy.value = field
      sortOrder.value = 'desc'
    }
    page.value = 1
  }

  return {
    platform,
    period,
    scopeQuery,
    socialAccountId,
    appId,
    runId,
    pipelineId,
    dateFrom,
    dateTo,
    sortBy,
    sortOrder,
    page,
    perPage,
    query,
    dashboardQuery,
    resetFilters,
    resetPage,
    toggleSort,
  }
})
