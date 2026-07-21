export const useUploadFiltersStore = defineStore('uploadFilters', () => {
  const status = ref<string>('')
  const videoId = ref<number | undefined>(undefined)
  const runId = ref<number | undefined>(undefined)
  const pipelineId = ref<number | undefined>(undefined)
  const page = ref<number>(1)
  const perPage = ref<number>(20)

  const query = computed(() => ({
    ...(status.value ? { status: status.value } : {}),
    ...(videoId.value ? { videoId: videoId.value } : {}),
    ...(runId.value ? { runId: runId.value } : {}),
    ...(pipelineId.value ? { pipelineId: pipelineId.value } : {}),
    page: page.value,
    perPage: perPage.value,
  }))

  function resetFilters() {
    status.value = ''
    videoId.value = undefined
    runId.value = undefined
    pipelineId.value = undefined
    page.value = 1
  }

  function resetPage() {
    page.value = 1
  }

  return { status, videoId, runId, pipelineId, page, perPage, query, resetFilters, resetPage }
})
