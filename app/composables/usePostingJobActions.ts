import type {
  BulkDeleteFilter,
  BulkDeleteResponse,
  DeletePostingJobResponse,
  PatchPostingJobRequest,
  PostingJobDto,
  PostingJobLogsResponse,
} from "~~/shared/types/posting-job"

/**
 * Действия над PostingJob: cancel/retry/load logs.
 */
export function usePostingJobActions() {
  const isProcessing = ref(false)
  const error = ref<string | null>(null)

  function extractError(e: unknown): string {
    return (
      (e as { data?: { message?: string } })?.data?.message
      ?? (e instanceof Error ? e.message : "Неизвестная ошибка")
    )
  }

  async function cancelJob(
    id: string,
    reason: string,
  ): Promise<PostingJobDto | null> {
    isProcessing.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: PostingJobDto }>(
        `/api/posting-jobs/${id}/cancel`,
        {
          method: "POST",
          body: { reason },
        },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  async function retryJob(id: string): Promise<PostingJobDto | null> {
    isProcessing.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: PostingJobDto }>(
        `/api/posting-jobs/${id}/retry`,
        { method: "POST" },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  async function fetchLogs(
    id: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<PostingJobLogsResponse | null> {
    error.value = null
    try {
      return await $fetch<PostingJobLogsResponse>(
        `/api/posting-jobs/${id}/logs`,
        {
          query: {
            limit: opts?.limit ?? 100,
            offset: opts?.offset ?? 0,
          },
        },
      )
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    }
  }

  /**
   * Hard-delete одной job. Возвращает результат либо null (ошибка в error.value).
   * При published без confirm / свежей in-flight без force сервер вернёт 409 —
   * вызывающий смотрит error и при необходимости повторяет с confirm/force.
   */
  async function deleteJob(
    id: string,
    opts?: { confirm?: boolean; force?: boolean },
  ): Promise<DeletePostingJobResponse | null> {
    isProcessing.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeletePostingJobResponse }>(
        `/api/posting-jobs/${id}`,
        {
          method: "DELETE",
          body: { confirm: opts?.confirm ?? false, force: opts?.force ?? false },
        },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  /**
   * Массовый hard-delete по ids ИЛИ по filter. Возвращает { deleted, deletedIds, skipped }
   * либо null (фатальная ошибка). skipped — частичные отказы (не валят весь bulk).
   */
  async function bulkDelete(opts: {
    ids?: string[]
    filter?: BulkDeleteFilter
    confirm?: boolean
    force?: boolean
  }): Promise<BulkDeleteResponse | null> {
    isProcessing.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: BulkDeleteResponse }>(
        "/api/posting-jobs/bulk-delete",
        {
          method: "POST",
          body: {
            ids: opts.ids,
            filter: opts.filter,
            confirm: opts.confirm ?? false,
            force: opts.force ?? false,
          },
        },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  /** Минимальный UPDATE (scheduledAt / maxAttempts) для scheduled/queued. (P2) */
  async function updateJob(
    id: string,
    patch: PatchPostingJobRequest,
  ): Promise<PostingJobDto | null> {
    isProcessing.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: PostingJobDto }>(
        `/api/posting-jobs/${id}`,
        { method: "PATCH", body: patch },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  return {
    isProcessing,
    error,
    cancelJob,
    retryJob,
    fetchLogs,
    deleteJob,
    bulkDelete,
    updateJob,
  }
}
