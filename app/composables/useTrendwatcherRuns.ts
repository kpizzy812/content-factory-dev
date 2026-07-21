/**
 * Composable для отслеживания запусков Trendwatcher.
 * Поддерживает polling активных запусков и восстановление состояния после refresh.
 */

interface TrendwatcherRunSummary {
  id: number
  profileId: number
  status: string
  triggerType: string
  startedAt: string
  completedAt: string | null
  foundCount: number
  importedCount: number
  skippedCount: number
  warningCount: number
  failureReason: string | null
  errorCategory: string | null
  errorStep: string | null
  errorSummary: string | null
  canRetry: boolean
  needsProfileFix: boolean
  profile: { id: number; name: string; actorId: string }
}

interface TrendwatcherRunDetail extends TrendwatcherRunSummary {
  externalRunId: string | null
  sourceType: string | null
  canceledAt: string | null
  datasetId: string | null
  analyzedCount: number
  initiatedBy: string | null
  apifyStatus: string | null
  apifyStatusMessage: string | null
  logs: Array<{
    id: number
    level: string
    message: string
    step: string | null
    payload: unknown | null
    createdAt: string
  }>
}

const ACTIVE_STATUSES = ['pending', 'starting', 'running', 'importing', 'analyzing']
const POLL_INTERVAL = 3000

export function useTrendwatcherActiveRuns() {
  const { data, refresh } = useFetch('/api/trendwatcher/runs/active', {
    key: 'tw-active-runs',
    server: false,
    lazy: true,
  })

  const activeRuns = computed<TrendwatcherRunSummary[]>(
    () => (data.value as { data: TrendwatcherRunSummary[] } | null)?.data ?? [],
  )

  const hasActive = computed(() => activeRuns.value.length > 0)

  // Polling
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function startPolling() {
    stopPolling()
    pollTimer = setInterval(() => {
      if (hasActive.value) {
        refresh()
      } else {
        stopPolling()
      }
    }, POLL_INTERVAL)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // Автоматически начинаем polling при наличии активных
  watch(hasActive, (active) => {
    if (active) {
      startPolling()
    } else {
      stopPolling()
    }
  }, { immediate: true })

  onUnmounted(stopPolling)

  function getActiveRunForProfile(profileId: number): TrendwatcherRunSummary | undefined {
    return activeRuns.value.find((r) => r.profileId === profileId)
  }

  function isProfileRunning(profileId: number): boolean {
    return activeRuns.value.some((r) => r.profileId === profileId)
  }

  return {
    activeRuns,
    hasActive,
    refresh,
    startPolling,
    stopPolling,
    getActiveRunForProfile,
    isProfileRunning,
  }
}

export function useTrendwatcherRunHistory(profileId?: Ref<number | undefined>) {
  const page = ref(1)

  const query = computed(() => {
    const q: Record<string, unknown> = { page: page.value, perPage: 20 }
    if (profileId?.value) q.profileId = profileId.value
    return q
  })

  const { data, pending, error, refresh } = useFetch('/api/trendwatcher/runs', {
    query,
    key: `tw-runs-${profileId?.value ?? 'all'}`,
    server: false,
    lazy: true,
  })

  const runs = computed<TrendwatcherRunSummary[]>(
    () => (data.value as { data: TrendwatcherRunSummary[]; meta: unknown } | null)?.data ?? [],
  )

  const meta = computed(
    () => (data.value as { meta: { total: number; page: number; totalPages: number } } | null)?.meta
      ?? { total: 0, page: 1, totalPages: 1 },
  )

  return { runs, meta, page, pending, error, refresh }
}

export function useTrendwatcherRunDetail(runId: Ref<number | null>) {
  const url = computed(() => runId.value ? `/api/trendwatcher/runs/${runId.value}` : '/api/trendwatcher/runs/active')

  const { data, pending, error, refresh } = useFetch(url, {
    key: computed(() => `tw-run-${runId.value}`),
    server: false,
    lazy: true,
    watch: [runId],
    immediate: !!runId.value,
  })

  const run = computed<TrendwatcherRunDetail | null>(
    () => (data.value as { data: TrendwatcherRunDetail } | null)?.data ?? null,
  )

  const isActive = computed(() => {
    return run.value ? ACTIVE_STATUSES.includes(run.value.status) : false
  })

  // Auto-poll when active
  let pollTimer: ReturnType<typeof setInterval> | null = null

  watch(isActive, (active) => {
    if (active) {
      pollTimer = setInterval(() => refresh(), POLL_INTERVAL)
    } else if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }, { immediate: true })

  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer)
  })

  async function cancelRun() {
    if (!runId.value) return
    await $fetch(`/api/trendwatcher/runs/${runId.value}`, { method: 'DELETE' })
    await refresh()
  }

  async function retryRun(): Promise<{ runId: number } | null> {
    if (!runId.value) return null
    const result = await $fetch<{ data: { runId: number } }>(`/api/trendwatcher/runs/${runId.value}/retry`, { method: 'POST' })
    return result?.data ?? null
  }

  return { run, pending, error, refresh, isActive, cancelRun, retryRun }
}

export function isRunActive(status: string): boolean {
  return ACTIVE_STATUSES.includes(status)
}
