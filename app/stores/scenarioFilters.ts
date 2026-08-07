export const useScenarioFiltersStore = defineStore('scenarioFilters', () => {
  const trendId = ref<number | undefined>(undefined)
  const runId = ref<number | undefined>(undefined)
  const pipelineId = ref<number | undefined>(undefined)
  const status = ref<string>('')
  const page = ref<number>(1)
  // Сортировка одной строкой: '-createdAt' — по убыванию, 'createdAt' — по
  // возрастанию. Тот же формат читает шапка таблицы и принимает сервер.
  const sort = ref<string>('-createdAt')
  const perPage = ref<number>(20)

  function resetFilters() {
    trendId.value = undefined
    runId.value = undefined
    pipelineId.value = undefined
    status.value = ''
    sort.value = '-createdAt'
    page.value = 1
  }

  function resetPage() {
    page.value = 1
  }

  return { trendId, runId, pipelineId, status, sort, page, perPage, resetFilters, resetPage }
})
