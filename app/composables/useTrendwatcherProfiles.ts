interface TrendwatcherProfileLastRun {
  id: number
  status: string
  startedAt: string
  completedAt: string | null
  foundCount: number
  importedCount: number
  failureReason: string | null
  triggerType: string
}

interface TrendwatcherProfile {
  id: number
  appId: number
  app: { id: number; name: string }
  name: string
  actorId: string
  keywords: string[]
  platforms: string[]
  language: string | null
  geo: string | null
  viewCountMin: number | null
  viewCountMax: number | null
  maxItems: number
  enabled: boolean
  scheduleEnabled: boolean
  scheduleCron: string | null
  scheduleTimezone: string
  scheduleNextRunAt: string | null
  scheduleLastRunAt: string | null
  lastRunId: number | null
  lastSuccessfulRunAt: string | null
  validationStatus: string | null
  validationSummary: string | null
  validatedAt: string | null
  isInline: boolean
  sourceNodeId: string | null
  sourcePipelineId: number | null
  hasActiveRun: boolean
  activeRunId: number | null
  lastRun: TrendwatcherProfileLastRun | null
  createdAt: string
  updatedAt: string
}

export function useTrendwatcherProfiles(appId?: Ref<number | undefined>) {
  const query = computed(() => (appId?.value ? { appId: appId.value } : {}))

  const { data, pending, error, refresh } = useFetch('/api/trendwatcher/profiles', {
    query,
    key: 'trendwatcher-profiles',
  })

  const profiles = computed<TrendwatcherProfile[]>(
    () => (data.value as { data: TrendwatcherProfile[] } | null)?.data ?? [],
  )

  async function createProfile(payload: {
    appId: number
    name: string
    actorId?: string
    keywords: string[]
    platforms: string[]
    language?: string
    geo?: string
    viewCountMin?: number | null
    viewCountMax?: number | null
    maxItems?: number
    isInline?: boolean
    sourceNodeId?: string
    sourcePipelineId?: number
  }) {
    const result = await $fetch('/api/trendwatcher/profiles', {
      method: 'POST',
      body: payload,
    })
    await refresh()
    return result
  }

  async function getProfile(id: number): Promise<TrendwatcherProfile | null> {
    try {
      const res = await $fetch<{ data: TrendwatcherProfile }>(`/api/trendwatcher/profiles/${id}`)
      return res.data
    } catch {
      return null
    }
  }

  async function updateProfile(id: number, payload: Record<string, unknown>) {
    const result = await $fetch(`/api/trendwatcher/profiles/${id}`, {
      method: 'PUT',
      body: payload,
    })
    await refresh()
    return result
  }

  async function deleteProfile(id: number) {
    const result = await $fetch(`/api/trendwatcher/profiles/${id}`, {
      method: 'DELETE',
    })
    await refresh()
    return result
  }

  async function runParsing(profileId: number) {
    const result = await $fetch('/api/trendwatcher/run', {
      method: 'POST',
      body: { profileId },
    })
    await refresh()
    return result
  }

  async function duplicateProfile(id: number) {
    const result = await $fetch(`/api/trendwatcher/profiles/${id}/duplicate`, {
      method: 'POST',
    })
    await refresh()
    return result
  }

  async function updateSchedule(id: number, payload: {
    scheduleEnabled?: boolean
    scheduleCron?: string | null
    scheduleTimezone?: string
  }) {
    const result = await $fetch(`/api/trendwatcher/profiles/${id}/schedule`, {
      method: 'PUT',
      body: payload,
    })
    await refresh()
    return result
  }

  async function validateProfile(id: number): Promise<TrendwatcherValidationResult> {
    const result = await $fetch<{ data: TrendwatcherValidationResult }>(`/api/trendwatcher/profiles/${id}/validate`, {
      method: 'POST',
    })
    await refresh()
    return result.data
  }

  return {
    profiles,
    pending,
    error,
    refresh,
    createProfile,
    updateProfile,
    deleteProfile,
    getProfile,
    runParsing,
    duplicateProfile,
    updateSchedule,
    validateProfile,
  }
}

export type { TrendwatcherProfile }

interface TrendwatcherValidationResult {
  profileId: number
  valid: boolean
  errorCode?: string
  errorSummary?: string
  nextAction?: string
  canRetry: boolean
  needsProfileFix: boolean
  actorFound?: boolean
  tokenValid?: boolean
}
