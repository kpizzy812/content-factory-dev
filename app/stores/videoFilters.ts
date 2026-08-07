export const useVideoFiltersStore = defineStore('videoFilters', () => {
  const status = ref<string>('')
  const scenarioId = ref<number | undefined>(undefined)
  const runId = ref<number | undefined>(undefined)
  const pipelineId = ref<number | undefined>(undefined)
  const page = ref<number>(1)
  // Сортировка: '-createdAt' — по убыванию, 'createdAt' — по возрастанию.
  // Тот же формат читает шапка таблицы и принимает сервер.
  const sort = ref<string>('-createdAt')
  const perPage = ref<number>(12)

  const query = computed(() => ({
    ...(status.value ? { status: status.value } : {}),
    ...(scenarioId.value ? { scenarioId: scenarioId.value } : {}),
    ...(runId.value ? { runId: runId.value } : {}),
    ...(pipelineId.value ? { pipelineId: pipelineId.value } : {}),
    sort: sort.value,
    page: page.value,
    perPage: perPage.value,
  }))

  function resetFilters() {
    status.value = ''
    scenarioId.value = undefined
    runId.value = undefined
    pipelineId.value = undefined
    sort.value = '-createdAt'
    page.value = 1
  }

  function resetPage() {
    page.value = 1
  }

  return { status, scenarioId, runId, pipelineId, sort, page, perPage, query, resetFilters, resetPage }
})
