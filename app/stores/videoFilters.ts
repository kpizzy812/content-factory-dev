export const useVideoFiltersStore = defineStore('videoFilters', () => {
  const status = ref<string>('')
  const scenarioId = ref<number | undefined>(undefined)
  const runId = ref<number | undefined>(undefined)
  const pipelineId = ref<number | undefined>(undefined)
  const page = ref<number>(1)
  const perPage = ref<number>(12)

  const query = computed(() => ({
    ...(status.value ? { status: status.value } : {}),
    ...(scenarioId.value ? { scenarioId: scenarioId.value } : {}),
    ...(runId.value ? { runId: runId.value } : {}),
    ...(pipelineId.value ? { pipelineId: pipelineId.value } : {}),
    page: page.value,
    perPage: perPage.value,
  }))

  function resetFilters() {
    status.value = ''
    scenarioId.value = undefined
    runId.value = undefined
    pipelineId.value = undefined
    page.value = 1
  }

  function resetPage() {
    page.value = 1
  }

  return { status, scenarioId, runId, pipelineId, page, perPage, query, resetFilters, resetPage }
})
