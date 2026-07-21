/**
 * Pipeline Monitor Store — состояние каталога и монитора исполнений /pipeline.
 *
 * viewMode и состояние раскрытия блоков каталог/монитор сохраняются в localStorage,
 * но чтение localStorage вынесено в hydrateFromStorage() (вызывается из onMounted
 * страницы), чтобы SSR и начальный клиентский рендер были идентичны (hydration safety).
 *
 * Состояние раскрытия конкретных конвейеров хранится в «инвертированном» виде:
 * храним только ID СВЁРНУТЫХ. Так по умолчанию все развёрнуты на сервере и клиенте —
 * hydration class mismatch на <PipelineMonitorRow> устраняется.
 */
const LS_VIEW_MODE = 'pipeline-monitor:view-mode'
const LS_CATALOG_EXPANDED = 'pipeline-monitor:catalog-expanded'
const LS_MONITOR_EXPANDED = 'pipeline-monitor:monitor-expanded'
const LS_DATA_FORMAT = 'pipeline-monitor:data-format'

function readLs(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(key)
  }
  catch {
    return null
  }
}

function writeLs(key: string, value: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, value)
  }
  catch {
    // storage недоступен (приватный режим, квота) — игнорируем
  }
}

export const usePipelineMonitorStore = defineStore('pipelineMonitor', () => {
  const catalogPage = ref(1)
  const catalogPerPage = ref(9)

  const viewMode = ref<'list' | 'cards'>('list')
  const searchQuery = ref('')
  const runsFilter = ref<'' | 'yes' | 'no'>('')
  const sortMode = ref<'active_first' | 'active_last'>('active_first')

  // Состояние блоков верхнего уровня (коллапсеры каталог/монитор).
  // Значения по умолчанию одинаковые на сервере и клиенте — инициализация
  // из localStorage происходит в hydrateFromStorage() (вызывается из onMounted
  // на странице /pipeline).
  const catalogBlockExpanded = ref<boolean>(true)
  const monitorBlockExpanded = ref<boolean>(true)

  // Формат отображения input/output шагов на странице деталей рана
  const dataFormat = ref<'readable' | 'json'>('readable')

  const hydrated = ref(false)

  function hydrateFromStorage() {
    if (hydrated.value) return
    hydrated.value = true
    if (typeof window === 'undefined') return

    const savedView = readLs(LS_VIEW_MODE)
    if (savedView === 'list' || savedView === 'cards') {
      viewMode.value = savedView
    }

    const savedCatalog = readLs(LS_CATALOG_EXPANDED)
    if (savedCatalog === '0') catalogBlockExpanded.value = false
    else if (savedCatalog === '1') catalogBlockExpanded.value = true

    const savedMonitor = readLs(LS_MONITOR_EXPANDED)
    if (savedMonitor === '0') monitorBlockExpanded.value = false
    else if (savedMonitor === '1') monitorBlockExpanded.value = true

    const savedDataFormat = readLs(LS_DATA_FORMAT)
    if (savedDataFormat === 'readable' || savedDataFormat === 'json') {
      dataFormat.value = savedDataFormat
    }
  }

  // Запись в localStorage безопасна в любой момент — writeLs сам проверит window.
  // Но watch срабатывает и от hydrateFromStorage, и от реальных пользовательских
  // изменений — в обоих случаях мы хотим сохранить значение.
  watch(viewMode, (v) => {
    writeLs(LS_VIEW_MODE, v)
  })

  watch(catalogBlockExpanded, (v) => {
    writeLs(LS_CATALOG_EXPANDED, v ? '1' : '0')
  })

  watch(monitorBlockExpanded, (v) => {
    writeLs(LS_MONITOR_EXPANDED, v ? '1' : '0')
  })

  watch(dataFormat, (v) => {
    writeLs(LS_DATA_FORMAT, v)
  })

  function toggleCatalogBlock() {
    catalogBlockExpanded.value = !catalogBlockExpanded.value
  }

  function toggleMonitorBlock() {
    monitorBlockExpanded.value = !monitorBlockExpanded.value
  }

  // IDs свёрнутых коллапсеров. По умолчанию все развёрнуты (т.е. пусты).
  // Это делает рендер на сервере и первом клиентском рендере идентичным.
  const collapsedPipelineIds = ref<number[]>([])
  // IDs видимых конвейеров (для collapseAll)
  const currentPipelineIds = ref<number[]>([])

  function isExpanded(id: number) {
    return !collapsedPipelineIds.value.includes(id)
  }

  function toggleExpanded(id: number) {
    const i = collapsedPipelineIds.value.indexOf(id)
    if (i === -1) collapsedPipelineIds.value.push(id)
    else collapsedPipelineIds.value.splice(i, 1)
  }

  function expandAll() {
    collapsedPipelineIds.value = []
  }

  function collapseAll() {
    collapsedPipelineIds.value = [...currentPipelineIds.value]
  }

  /**
   * Синхронизация списка id с сервера.
   * Новые id по умолчанию развёрнуты (их нет в collapsed — и не надо добавлять).
   * Чистим collapsed от id, которых больше нет в списке.
   */
  function syncFromServer(ids: number[]) {
    collapsedPipelineIds.value = collapsedPipelineIds.value.filter(id => ids.includes(id))
    currentPipelineIds.value = [...ids]
  }

  function resetFilters() {
    searchQuery.value = ''
    runsFilter.value = ''
  }

  const monitorQuery = computed(() => ({
    page: catalogPage.value,
    perPage: catalogPerPage.value,
    search: searchQuery.value || undefined,
    hasRuns: runsFilter.value || undefined,
    sort: sortMode.value,
    runsPerPipeline: 5,
  }))

  // Сброс страницы при смене фильтров/сортировки. Для searchQuery сброс делается
  // в composable usePipelineMonitor по дебаунсед-значению, иначе страница сбрасывалась
  // бы на каждую букву ввода до срабатывания debounce.
  watch([runsFilter, sortMode], () => {
    catalogPage.value = 1
  })

  return {
    catalogPage,
    catalogPerPage,
    viewMode,
    searchQuery,
    runsFilter,
    sortMode,
    catalogBlockExpanded,
    monitorBlockExpanded,
    dataFormat,
    hydrated,
    hydrateFromStorage,
    toggleCatalogBlock,
    toggleMonitorBlock,
    collapsedPipelineIds,
    currentPipelineIds,
    isExpanded,
    toggleExpanded,
    expandAll,
    collapseAll,
    syncFromServer,
    resetFilters,
    monitorQuery,
  }
})
