import type {
  ProxyCheckResult,
  ProxyCreateInput,
  ProxyDto,
  ProxyHealthCheckDto,
  ProxyUpdateInput,
} from "~~/shared/types/proxy"

interface RevealedProxyCredentials {
  host: string | null
  port: number
  username: string | null
  password: string | null
  rotationUrl: string | null
  formatted: string
}

export interface BulkCheckResultItem {
  id: string
  label: string
  ok: boolean
  errorCategory: string | null
  errorMessage: string | null
}

export interface BulkCheckResult {
  total: number
  successful: number
  failed: number
  results: BulkCheckResultItem[]
}

/**
 * useProxyActions — методы CRUD/health/reveal для прокси.
 */
export function useProxyActions() {
  const isBusy = ref(false)
  const error = ref<string | null>(null)

  function extractError(e: unknown): string {
    return (
      (e as { data?: { message?: string } })?.data?.message
      ?? (e instanceof Error ? e.message : "Неизвестная ошибка")
    )
  }

  async function createProxy(input: ProxyCreateInput): Promise<ProxyDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: ProxyDto }>("/api/proxies", {
        method: "POST",
        body: input,
      })
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function updateProxy(
    id: string,
    input: ProxyUpdateInput,
  ): Promise<ProxyDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: ProxyDto }>(`/api/proxies/${id}`, {
        method: "PUT",
        body: input,
      })
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function deleteProxy(id: string): Promise<boolean> {
    isBusy.value = true
    error.value = null
    try {
      await $fetch(`/api/proxies/${id}`, { method: "DELETE" })
      return true
    } catch (e: unknown) {
      error.value = extractError(e)
      return false
    } finally {
      isBusy.value = false
    }
  }

  async function checkProxy(id: string): Promise<ProxyCheckResult | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: ProxyCheckResult }>(
        `/api/proxies/${id}/check`,
        { method: "POST" },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function getCheckHistory(id: string): Promise<ProxyHealthCheckDto[]> {
    error.value = null
    try {
      const res = await $fetch<{ data: ProxyHealthCheckDto[] }>(
        `/api/proxies/${id}/checks`,
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return []
    }
  }

  async function revealProxy(
    id: string,
    reason: string,
  ): Promise<RevealedProxyCredentials | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: RevealedProxyCredentials }>(
        `/api/proxies/${id}/reveal`,
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
      isBusy.value = false
    }
  }

  async function checkAllProxies(): Promise<BulkCheckResult | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: BulkCheckResult }>(
        "/api/proxies/check-all",
        { method: "POST" },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  return {
    isBusy,
    error,
    createProxy,
    updateProxy,
    deleteProxy,
    checkProxy,
    checkAllProxies,
    getCheckHistory,
    revealProxy,
  }
}
