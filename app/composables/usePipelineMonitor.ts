import type { PipelineMonitorItem, PipelineMonitorMeta } from '~~/shared/types/workflow'

/**
 * Композабл для страницы /pipeline — центр мониторинга исполнений.
 *
 * Polling 3 с с паузой при tab hidden и отсутствии активных ранов.
 * SSR-safe: document доступен только на клиенте.
 *
 * Query-реактивность: передаём в useFetch функцию, возвращающую объект query.
 * Nuxt 4 автоматически подпишется на реактивные зависимости внутри — и перефетчит
 * при изменении searchQuery/runsFilter/sortMode/catalogPage.
 *
 * Debounce для поиска: 300 мс на входной ref, чтобы не дёргать API на каждой букве.
 */
const SEARCH_DEBOUNCE_MS = 300

export function usePipelineMonitor() {
  const store = usePipelineMonitorStore()

  // Debounced-копия searchQuery для сетевого запроса.
  // Ввод в поле остаётся мгновенным (v-model на store.searchQuery),
  // а useFetch подписывается на debouncedSearch.
  const debouncedSearch = ref(store.searchQuery)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  watch(
    () => store.searchQuery,
    (v) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debouncedSearch.value = v
      }, SEARCH_DEBOUNCE_MS)
    },
  )

  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  const { data, pending, error, refresh } = useFetch<{
    data: PipelineMonitorItem[]
    meta: PipelineMonitorMeta
  }>('/api/pipelines/monitor', {
    query: computed(() => ({
      page: store.catalogPage,
      perPage: store.catalogPerPage,
      search: debouncedSearch.value || undefined,
      hasRuns: store.runsFilter || undefined,
      sort: store.sortMode,
      runsPerPipeline: 5,
    })),
  })

  // Сброс страницы при смене дебаунсед-поиска. Сброс для runsFilter/sortMode
  // уже сделан в store (там же нет дебаунса).
  watch(debouncedSearch, () => {
    if (store.catalogPage !== 1) store.catalogPage = 1
  })

  watch(data, (d) => {
    if (d?.data) store.syncFromServer(d.data.map(p => p.id))
  })

  const hasActive = computed(() =>
    (data.value?.data ?? []).some(p => p.activeRuns.length > 0),
  )

  let timer: ReturnType<typeof setInterval> | null = null
  let visible = true

  function stopPolling() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function onVisibilityChange() {
    visible = document.visibilityState === 'visible'
    if (visible && hasActive.value) refresh()
  }

  onMounted(() => {
    // Изначальная синхронизация после гидрации (на сервере data уже есть,
    // но watch(data) без immediate не сработал — делаем это руками).
    if (data.value?.data) {
      store.syncFromServer(data.value.data.map(p => p.id))
    }

    visible = document.visibilityState === 'visible'
    document.addEventListener('visibilitychange', onVisibilityChange)
    timer = setInterval(() => {
      if (hasActive.value && visible) refresh()
    }, 3000)
  })

  onUnmounted(() => {
    stopPolling()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  })

  return { data, pending, error, refresh, hasActive }
}
