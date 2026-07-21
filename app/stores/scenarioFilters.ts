export const useScenarioFiltersStore = defineStore('scenarioFilters', () => {
  const trendId = ref<number | undefined>(undefined)
  const runId = ref<number | undefined>(undefined)
  const pipelineId = ref<number | undefined>(undefined)
  const status = ref<string>('')
  const page = ref<number>(1)
  const perPage = ref<number>(20)

  function resetFilters() {
    trendId.value = undefined
    runId.value = undefined
    pipelineId.value = undefined
    status.value = ''
    page.value = 1
  }

  function resetPage() {
    page.value = 1
  }

  return { trendId, runId, pipelineId, status, page, perPage, resetFilters, resetPage }
})
