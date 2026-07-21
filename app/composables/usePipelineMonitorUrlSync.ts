/**
 * Синхронизация фильтров/сортировки/пагинации монитора конвейеров с URL.
 *
 * URL → state: выполняется один раз в setup (до первого useFetch), чтобы
 * запрос сразу пошёл с нужными параметрами и SSR/CSR получили идентичные данные.
 *
 * state → URL: через router.replace. Для searchQuery — с дебаунсом 300 мс,
 * чтобы не плодить history-replace на каждой букве. Для остальных (runsFilter,
 * sortMode, page, viewMode) — немедленно.
 *
 * Синкаются: search, runs (hasRuns filter), sort, page, view (list/cards).
 */
const QS_SEARCH = 'search'
const QS_RUNS = 'runs'
const QS_SORT = 'sort'
const QS_PAGE = 'page'
const QS_VIEW = 'view'

const URL_DEBOUNCE_MS = 300

export function usePipelineMonitorUrlSync() {
  const store = usePipelineMonitorStore()
  const route = useRoute()
  const router = useRouter()

  // --- URL → state (один раз, до рендера) ---
  const q = route.query

  const qSearch = typeof q[QS_SEARCH] === 'string' ? (q[QS_SEARCH] as string) : ''
  if (qSearch) store.searchQuery = qSearch

  const qRuns = q[QS_RUNS]
  if (qRuns === 'yes' || qRuns === 'no') {
    store.runsFilter = qRuns
  }

  const qSort = q[QS_SORT]
  if (qSort === 'active_first' || qSort === 'active_last') {
    store.sortMode = qSort
  }

  const qView = q[QS_VIEW]
  if (qView === 'list' || qView === 'cards') {
    store.viewMode = qView
  }

  const qPage = Number(q[QS_PAGE])
  if (Number.isFinite(qPage) && qPage > 0) {
    store.catalogPage = qPage
  }

  // --- state → URL ---
  let urlTimer: ReturnType<typeof setTimeout> | null = null

  function buildQuery(): Record<string, string> {
    const next: Record<string, string> = {}
    // Сохраняем прочие query-параметры (runId/pipelineId и прочее).
    for (const [k, v] of Object.entries(route.query)) {
      if (k === QS_SEARCH || k === QS_RUNS || k === QS_SORT || k === QS_PAGE || k === QS_VIEW) continue
      if (typeof v === 'string') next[k] = v
    }

    if (store.searchQuery) next[QS_SEARCH] = store.searchQuery
    if (store.runsFilter) next[QS_RUNS] = store.runsFilter
    if (store.sortMode !== 'active_first') next[QS_SORT] = store.sortMode
    if (store.catalogPage > 1) next[QS_PAGE] = String(store.catalogPage)
    if (store.viewMode !== 'list') next[QS_VIEW] = store.viewMode

    return next
  }

  function applyNow() {
    router.replace({ query: buildQuery() })
  }

  function applyDebounced() {
    if (urlTimer) clearTimeout(urlTimer)
    urlTimer = setTimeout(applyNow, URL_DEBOUNCE_MS)
  }

  // Search с дебаунсом — чтобы не создавать history-replace на каждой букве.
  watch(() => store.searchQuery, applyDebounced)

  // Остальные фильтры — моментально.
  watch(
    [
      () => store.runsFilter,
      () => store.sortMode,
      () => store.catalogPage,
      () => store.viewMode,
    ],
    () => {
      // Если есть отложенный search-apply, отменяем — applyNow всё включит.
      if (urlTimer) {
        clearTimeout(urlTimer)
        urlTimer = null
      }
      applyNow()
    },
  )

  onUnmounted(() => {
    if (urlTimer) clearTimeout(urlTimer)
  })
}
