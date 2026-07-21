import { toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

export interface UseAiSuggestOptions {
  cacheKey?: MaybeRefOrGetter<string | null | undefined>
}

export function useAiSuggest<T>(endpoint: string, options: UseAiSuggestOptions = {}) {
  const store = useAiCacheStore()
  const localResult = ref<T | null>(null) as Ref<T | null>
  const localLoading = ref(false)
  const localError = ref<string | null>(null)

  const activeKey = computed(() => {
    const raw = toValue(options.cacheKey)
    return raw && raw.length > 0 ? raw : null
  })

  const result = computed<T | null>({
    get() {
      const key = activeKey.value
      if (!key) return localResult.value
      return (store.getEntry<T>(key)?.result ?? null)
    },
    set(value) {
      const key = activeKey.value
      if (!key) {
        localResult.value = value
        return
      }
      store.setResult<T>(key, value)
    },
  })

  const loading = computed<boolean>({
    get() {
      const key = activeKey.value
      if (!key) return localLoading.value
      return store.getEntry(key)?.loading ?? false
    },
    set(value) {
      const key = activeKey.value
      if (!key) {
        localLoading.value = value
        return
      }
      store.setLoading(key, value)
    },
  })

  const error = computed<string | null>({
    get() {
      const key = activeKey.value
      if (!key) return localError.value
      return store.getEntry(key)?.error ?? null
    },
    set(value) {
      const key = activeKey.value
      if (!key) {
        localError.value = value
        return
      }
      store.setError(key, value)
    },
  })

  async function suggest(body: Record<string, unknown>): Promise<T | null> {
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: T }>(endpoint, { method: 'POST', body })
      result.value = res.data
      return res.data
    } catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Ошибка AI'
      return null
    } finally {
      loading.value = false
    }
  }

  function reset() {
    const key = activeKey.value
    if (!key) {
      localResult.value = null
      localError.value = null
      localLoading.value = false
      return
    }
    store.clear(key)
  }

  return { loading, error, result, suggest, reset }
}
