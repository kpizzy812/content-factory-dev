import type { WorkflowRun } from '~/shared/types/workflow'

export function usePipelineRunDetail(
  pipelineId: Ref<number | string> | ComputedRef<number | string>,
  runId: Ref<number | string> | ComputedRef<number | string>,
) {
  const { data, pending, error, refresh } = useFetch<{ data: WorkflowRun }>(
    () => `/api/pipelines/${unref(pipelineId)}/runs/${unref(runId)}`,
    {
      watch: [pipelineId, runId],
    },
  )

  // Polling каждые 2 секунды, пока статус running или pending
  const isActive = computed(() => {
    const status = data.value?.data?.status
    return status === 'running' || status === 'pending'
  })

  let pollTimer: ReturnType<typeof setInterval> | null = null

  function startPolling() {
    stopPolling()
    pollTimer = setInterval(() => {
      if (isActive.value) {
        refresh()
      } else {
        stopPolling()
      }
    }, 2000)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  watch(isActive, (active) => {
    if (active) {
      startPolling()
    } else {
      stopPolling()
    }
  }, { immediate: true })

  onUnmounted(() => {
    stopPolling()
  })

  return { data, pending, error, refresh, isActive }
}
