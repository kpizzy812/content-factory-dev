import type { AnalyticsFilters } from '#shared/types/analytics'

export const useAnalyticsFiltersStore = defineStore('analyticsFilters', () => {
  const platform = ref<AnalyticsFilters['platform'] | ''>('')
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

  function resetFilters() {
    platform.value = ''
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
