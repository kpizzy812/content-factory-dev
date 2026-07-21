export const useTrendFiltersStore = defineStore('trendFilters', () => {
  const status = ref<string>('')
  const platform = ref<string>('')
  const search = ref<string>('')
  const sort = ref<string>('importedAt')
  const source = ref<string>('')
  const page = ref<number>(1)

  // New filters
  const hashtags = ref<string>('')
  const geo = ref<string>('')
  const language = ref<string>('')
  const viewCountMin = ref<string>('')
  const viewCountMax = ref<string>('')
  const analysisStatus = ref<string>('')

  // Pipeline/run filter (из монитора исполнений)
  const runId = ref<number | undefined>(undefined)
  const pipelineId = ref<number | undefined>(undefined)

  const query = computed(() => ({
    ...(status.value ? { status: status.value } : {}),
    ...(platform.value ? { platform: platform.value } : {}),
    ...(search.value ? { search: search.value } : {}),
    ...(source.value ? { source: source.value } : {}),
    ...(hashtags.value ? { hashtags: hashtags.value } : {}),
    ...(geo.value ? { geo: geo.value } : {}),
    ...(language.value ? { language: language.value } : {}),
    ...(viewCountMin.value ? { viewCountMin: viewCountMin.value } : {}),
    ...(viewCountMax.value ? { viewCountMax: viewCountMax.value } : {}),
    ...(analysisStatus.value ? { analysisStatus: analysisStatus.value } : {}),
    ...(runId.value ? { runId: runId.value } : {}),
    ...(pipelineId.value ? { pipelineId: pipelineId.value } : {}),
    sort: sort.value,
    page: page.value,
    perPage: 20,
  }))

  function reset() {
    status.value = ''
    platform.value = ''
    search.value = ''
    sort.value = 'importedAt'
    source.value = ''
    hashtags.value = ''
    geo.value = ''
    language.value = ''
    viewCountMin.value = ''
    viewCountMax.value = ''
    analysisStatus.value = ''
    runId.value = undefined
    pipelineId.value = undefined
    page.value = 1
  }

  function resetPage() {
    page.value = 1
  }

  return {
    status, platform, search, sort, source, page,
    hashtags, geo, language, viewCountMin, viewCountMax, analysisStatus,
    runId, pipelineId,
    query, reset, resetPage,
  }
})
