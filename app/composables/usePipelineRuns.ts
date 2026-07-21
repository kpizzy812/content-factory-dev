import type { WorkflowRun, WorkflowRunListMeta } from '~/shared/types/workflow'

export function usePipelineRuns(
  pipelineId: Ref<number | string> | ComputedRef<number | string>,
  page?: Ref<number>,
) {
  return useFetch<{ data: WorkflowRun[]; meta: WorkflowRunListMeta }>(
    () => `/api/pipelines/${unref(pipelineId)}/runs`,
    {
      query: { page: page ?? 1 },
      watch: [pipelineId, ...(page ? [page] : [])],
    },
  )
}
