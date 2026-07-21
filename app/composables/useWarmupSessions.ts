import type {
  WarmupSessionDto,
  WarmupSessionListResponse,
} from "~~/shared/types/warmup"

/**
 * Реактивный fetch списка WarmupSession (по фильтрам из warmupFilters store).
 */
export function useWarmupSessions() {
  const filters = useWarmupFiltersStore()
  const fetchResult = useFetch<WarmupSessionListResponse>("/api/warmup/sessions", {
    query: computed(() => filters.query),
  })

  const sessions = computed<WarmupSessionDto[]>(() => fetchResult.data.value?.items ?? [])
  const total = computed<number>(() => fetchResult.data.value?.total ?? 0)

  return {
    ...fetchResult,
    sessions,
    total,
  }
}

/**
 * История warmup-сессий по конкретному аккаунту (отдельный endpoint).
 * accountId — реактивный параметр (Ref или getter).
 */
export function useWarmupSessionsByAccount(
  accountId: Ref<number | null> | (() => number | null),
  opts: { limit?: number } = {},
) {
  const accountIdRef = isRef(accountId) ? accountId : computed(() => accountId())
  const url = computed(() => {
    const id = accountIdRef.value
    return id ? `/api/warmup/accounts/${id}/sessions` : ""
  })

  const fetchResult = useFetch<WarmupSessionListResponse>(url, {
    query: computed(() => ({ limit: opts.limit ?? 20 })),
    immediate: !!accountIdRef.value,
    watch: [accountIdRef],
  })

  const sessions = computed<WarmupSessionDto[]>(() => fetchResult.data.value?.items ?? [])
  const total = computed<number>(() => fetchResult.data.value?.total ?? 0)

  return {
    ...fetchResult,
    sessions,
    total,
  }
}
