export const useUploadFiltersStore = defineStore('uploadFilters', () => {
  const status = ref<string>('')
  const videoId = ref<number | undefined>(undefined)
  const runId = ref<number | undefined>(undefined)
  const pipelineId = ref<number | undefined>(undefined)
  const page = ref<number>(1)
  // Сортировка одной строкой: '-createdAt' — по убыванию, 'createdAt' — по
  // возрастанию. Тот же формат читает шапка таблицы и принимает сервер.
  const sort = ref<string>('-createdAt')
  const perPage = ref<number>(20)

  const query = computed(() => ({
    ...(status.value ? { status: status.value } : {}),
    ...(videoId.value ? { videoId: videoId.value } : {}),
    ...(runId.value ? { runId: runId.value } : {}),
    ...(pipelineId.value ? { pipelineId: pipelineId.value } : {}),
    sort: sort.value,
    page: page.value,
    perPage: perPage.value,
  }))

  function resetFilters() {
    status.value = ''
    videoId.value = undefined
    runId.value = undefined
    pipelineId.value = undefined
    sort.value = '-createdAt'
    page.value = 1
  }

  function resetPage() {
    page.value = 1
  }

  return { status, videoId, runId, pipelineId, sort, page, perPage, query, resetFilters, resetPage }
})
