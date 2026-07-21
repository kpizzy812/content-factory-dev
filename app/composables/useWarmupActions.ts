import type {
  AccountAgeBucket,
  WarmupPlan,
  WarmupSessionDto,
} from "~~/shared/types/warmup"

export interface PreviewResult {
  plan: WarmupPlan
  dayKey: string
  seed: string
  ageBucket: AccountAgeBucket
}

interface PreviewBody {
  scheduledAt?: string
  targetDurationMinutes?: number
}

interface ScheduleBody extends PreviewBody {
  replace?: boolean
}

/**
 * Действия над WarmupSession: preview, schedule, cancel.
 */
export function useWarmupActions() {
  const isProcessing = ref(false)
  const error = ref<string | null>(null)
  /** При conflict (409) — id существующей сессии. UI показывает «Заменить?». */
  const conflictSessionId = ref<string | null>(null)

  function extractError(e: unknown): string {
    return (
      (e as { data?: { message?: string } })?.data?.message
      ?? (e instanceof Error ? e.message : "Неизвестная ошибка")
    )
  }

  function extractConflictSessionId(e: unknown): string | null {
    const data = (e as { data?: { data?: { existingSessionId?: string } } })?.data?.data
    return data?.existingSessionId ?? null
  }

  async function previewPlan(
    accountId: number,
    body: PreviewBody = {},
  ): Promise<PreviewResult | null> {
    isProcessing.value = true
    error.value = null
    conflictSessionId.value = null
    try {
      const res = await $fetch<{ data: PreviewResult }>(
        `/api/warmup/accounts/${accountId}/preview`,
        {
          method: "POST",
          body,
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

  async function schedulePlan(
    accountId: number,
    body: ScheduleBody = {},
  ): Promise<WarmupSessionDto | null> {
    isProcessing.value = true
    error.value = null
    conflictSessionId.value = null
    try {
      const res = await $fetch<{ data: WarmupSessionDto }>(
        `/api/warmup/accounts/${accountId}/schedule`,
        {
          method: "POST",
          body,
        },
      )
      return res.data
    } catch (e: unknown) {
      const status = (e as { statusCode?: number })?.statusCode
      if (status === 409) {
        conflictSessionId.value = extractConflictSessionId(e)
      }
      error.value = extractError(e)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  async function cancelSession(id: string): Promise<WarmupSessionDto | null> {
    isProcessing.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: WarmupSessionDto }>(
        `/api/warmup/sessions/${id}/cancel`,
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

  async function deleteSession(id: string): Promise<boolean> {
    isProcessing.value = true
    error.value = null
    try {
      await $fetch<{ data: { deleted: true } }>(
        `/api/warmup/sessions/${id}`,
        { method: "DELETE" },
      )
      return true
    } catch (e: unknown) {
      error.value = extractError(e)
      return false
    } finally {
      isProcessing.value = false
    }
  }

  return {
    isProcessing,
    error,
    conflictSessionId,
    previewPlan,
    schedulePlan,
    cancelSession,
    deleteSession,
  }
}
