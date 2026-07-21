import {
  POSTING_JOB_ACTIVE_STATUSES,
  type PostingJobDto,
  type PostingJobListResponse,
  type PostingJobStats,
} from "~~/shared/types/posting-job"

/**
 * Реактивный fetch списка PostingJob по фильтрам из postingJobFilters store.
 *
 * Polling: если в текущем списке есть хотя бы один job в active-статусе
 * (scheduled/queued/preparing/uploading/retry_queued), запускаем refresh
 * каждые 5 секунд. Когда все jobs ушли в terminal — polling сам останавливается.
 */
export function usePostingJobs() {
  const filters = usePostingJobFiltersStore()

  const fetchResult = useFetch<PostingJobListResponse>("/api/posting-jobs", {
    query: computed(() => filters.query),
  })

  const jobs = computed<PostingJobDto[]>(() => fetchResult.data.value?.items ?? [])
  const total = computed<number>(() => fetchResult.data.value?.total ?? 0)
  // Состояние DuoPlus-движка (гейт DUOPLUS_ENGINE_ENABLED) — для инфо-плашки
  // freeze/active на странице постинга.
  const engine = computed(() => fetchResult.data.value?.engine ?? null)

  const hasActiveJobs = computed(() =>
    jobs.value.some((j) => POSTING_JOB_ACTIVE_STATUSES.includes(j.status)),
  )

  let pollTimer: ReturnType<typeof setInterval> | null = null

  function startPolling() {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      // Только если в видимом списке всё ещё есть активные
      if (hasActiveJobs.value) {
        fetchResult.refresh()
      }
    }, 5000)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // Авто-запуск polling'а: только на клиенте
  if (import.meta.client) {
    watch(
      hasActiveJobs,
      (has) => {
        if (has) {
          startPolling()
        } else {
          stopPolling()
        }
      },
      { immediate: true },
    )

    onBeforeUnmount(() => {
      stopPolling()
    })
  }

  return {
    ...fetchResult,
    jobs,
    total,
    engine,
    hasActiveJobs,
    startPolling,
    stopPolling,
  }
}

/**
 * Фетч агрегированной статистики PostingJob.
 * Не реактивен к фильтрам — статистика всегда по всем jobs.
 */
export function usePostingJobStats() {
  return useFetch<{ data: PostingJobStats }>("/api/posting-jobs/stats")
}
