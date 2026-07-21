import {
  ADMIN_LOG_SOURCES_ALL,
  type AdminLogSource,
} from '~~/shared/types/admin-log'

export const useAdminFiltersStore = defineStore('adminFilters', () => {
  // Логи: мульти-источник + уровень + resolved + текстовый поиск
  const logSources = ref<AdminLogSource[]>([...ADMIN_LOG_SOURCES_ALL])
  const logLevel = ref<string>('')
  const logResolved = ref<string>('')
  const logQ = ref<string>('')

  // Циклы
  const cycleStatus = ref<string>('')
  const cycleAppId = ref<number | undefined>(undefined)

  // Пагинация
  const page = ref<number>(1)
  const perPage = ref<number>(30)

  const logQuery = computed(() => ({
    // Передаём sources только если выбраны не все — иначе сервер возьмёт все по умолчанию.
    ...(logSources.value.length > 0 &&
    logSources.value.length < ADMIN_LOG_SOURCES_ALL.length
      ? { sources: logSources.value.join(',') }
      : {}),
    ...(logLevel.value ? { level: logLevel.value } : {}),
    ...(logResolved.value ? { resolved: logResolved.value } : {}),
    ...(logQ.value.trim() ? { q: logQ.value.trim() } : {}),
    page: page.value,
    limit: perPage.value,
  }))

  const cycleQuery = computed(() => ({
    ...(cycleStatus.value ? { status: cycleStatus.value } : {}),
    ...(cycleAppId.value ? { appId: cycleAppId.value } : {}),
    page: page.value,
    limit: perPage.value,
  }))

  function resetLogFilters() {
    logSources.value = [...ADMIN_LOG_SOURCES_ALL]
    logLevel.value = ''
    logResolved.value = ''
    logQ.value = ''
    page.value = 1
  }

  function resetCycleFilters() {
    cycleStatus.value = ''
    cycleAppId.value = undefined
    page.value = 1
  }

  function resetPage() {
    page.value = 1
  }

  function toggleLogSource(source: AdminLogSource) {
    const idx = logSources.value.indexOf(source)
    if (idx === -1) logSources.value.push(source)
    else logSources.value.splice(idx, 1)
    page.value = 1
  }

  function selectAllLogSources() {
    logSources.value = [...ADMIN_LOG_SOURCES_ALL]
    page.value = 1
  }

  function clearLogSources() {
    logSources.value = []
    page.value = 1
  }

  return {
    logSources,
    logLevel,
    logResolved,
    logQ,
    cycleStatus,
    cycleAppId,
    page,
    perPage,
    logQuery,
    cycleQuery,
    resetLogFilters,
    resetCycleFilters,
    resetPage,
    toggleLogSource,
    selectAllLogSources,
    clearLogSources,
  }
})
