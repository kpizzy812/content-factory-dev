import type {
  WarmupKeywordPoolDto,
  WarmupKeywordPoolListResponse,
  WarmupPlatform,
} from "~~/shared/types/warmup"

export interface KeywordPoolUpsertBody {
  name: string
  appId?: number | null
  language?: string | null
  category: string
  platform?: WarmupPlatform | null
  keywords: string[]
  hashtags?: string[]
  isActive?: boolean
}

/**
 * CRUD для WarmupKeywordPool.
 * useWarmupKeywords() — list + actions.
 */
export function useWarmupKeywords() {
  const fetchResult = useFetch<WarmupKeywordPoolListResponse>(
    "/api/warmup/keywords",
    { query: { limit: 200 } },
  )

  const pools = computed<WarmupKeywordPoolDto[]>(() => fetchResult.data.value?.items ?? [])
  const total = computed<number>(() => fetchResult.data.value?.total ?? 0)

  const isProcessing = ref(false)
  const error = ref<string | null>(null)

  function extractError(e: unknown): string {
    return (
      (e as { data?: { message?: string } })?.data?.message
      ?? (e instanceof Error ? e.message : "Неизвестная ошибка")
    )
  }

  async function createPool(body: KeywordPoolUpsertBody): Promise<WarmupKeywordPoolDto | null> {
    isProcessing.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: WarmupKeywordPoolDto }>("/api/warmup/keywords", {
        method: "POST",
        body,
      })
      await fetchResult.refresh()
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  async function updatePool(
    id: string,
    body: Partial<KeywordPoolUpsertBody>,
  ): Promise<WarmupKeywordPoolDto | null> {
    isProcessing.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: WarmupKeywordPoolDto }>(
        `/api/warmup/keywords/${id}`,
        { method: "PUT", body },
      )
      await fetchResult.refresh()
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  async function deletePool(id: string): Promise<boolean> {
    isProcessing.value = true
    error.value = null
    try {
      await $fetch(`/api/warmup/keywords/${id}`, { method: "DELETE" })
      await fetchResult.refresh()
      return true
    } catch (e: unknown) {
      error.value = extractError(e)
      return false
    } finally {
      isProcessing.value = false
    }
  }

  return {
    ...fetchResult,
    pools,
    total,
    isProcessing,
    error,
    createPool,
    updatePool,
    deletePool,
  }
}
