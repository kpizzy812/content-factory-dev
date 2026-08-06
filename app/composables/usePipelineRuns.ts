import type { RunStatus, WorkflowRun, WorkflowRunListMeta } from '~/shared/types/workflow'

/** Что пришло со строкой запуска сверх схемы: конвейер, автор, размер графа. */
export interface WorkflowRunRow extends WorkflowRun {
  pipeline?: { id: number; name: string; icon: string | null; color: string | null } | null
  triggeredByUser?: { id: number; name: string | null; surname: string | null; email: string } | null
  /** Блоков в снимке графа этого запуска. Ноль — снимка нет. */
  totalNodes?: number
  /** Блоков пройдено — закрытых движком, а не просто заведённых строк. */
  doneSteps?: number
  /** Шаг, который идёт прямо сейчас. Только у запусков в работе. */
  currentStep?: { nodeId: string; nodeName: string; nodeType: string } | null
}

/** Мета списка запусков: разбивка по статусам не зависит от включённого фильтра. */
export interface RunListMeta extends WorkflowRunListMeta {
  statusCounts: Record<RunStatus, number>
  statusTotal: number
}

export interface RunListFilters {
  /** Пусто — все статусы. */
  statuses?: Ref<RunStatus[]>
  /** Календарный день `YYYY-MM-DD`; пусто — за всё время. */
  day?: Ref<string | null>
}

function buildQuery(page: Ref<number> | undefined, filters?: RunListFilters) {
  return computed(() => ({
    page: page?.value ?? 1,
    // Пустую строку не шлём: endpoint отбросит её сам, но в адресе она мусор.
    ...(filters?.statuses?.value.length ? { status: filters.statuses.value.join(',') } : {}),
    ...(filters?.day?.value ? { day: filters.day.value } : {}),
  }))
}

/** История запусков одного конвейера. */
export function usePipelineRuns(
  pipelineId: Ref<number | string> | ComputedRef<number | string>,
  page?: Ref<number>,
  filters?: RunListFilters,
) {
  const query = buildQuery(page, filters)
  return useFetch<{ data: WorkflowRunRow[]; meta: RunListMeta }>(
    () => `/api/pipelines/${unref(pipelineId)}/runs`,
    {
      query,
      watch: [pipelineId, query],
    },
  )
}

/**
 * Запуски по всем доступным конвейерам — общий экран монитора.
 * Отличается от `usePipelineRuns` только адресом: мета и состав строк общие.
 */
export function useAllPipelineRuns(
  page?: Ref<number>,
  filters?: RunListFilters & { pipelineId?: Ref<number | null> },
) {
  const query = computed(() => ({
    ...buildQuery(page, filters).value,
    ...(filters?.pipelineId?.value ? { pipelineId: filters.pipelineId.value } : {}),
  }))
  return useFetch<{ data: WorkflowRunRow[]; meta: RunListMeta }>('/api/pipelines/runs', {
    key: 'pipeline-runs-all',
    query,
    watch: [query],
  })
}
