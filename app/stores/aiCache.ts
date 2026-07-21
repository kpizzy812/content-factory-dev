export interface AiCacheEntry<T = unknown> {
  result: T | null
  error: string | null
  loading: boolean
  prompt: string
  expanded: boolean
  selectedFields: Record<string, boolean>
  updatedAt: number
}

function createEmptyEntry<T>(): AiCacheEntry<T> {
  return {
    result: null,
    error: null,
    loading: false,
    prompt: '',
    expanded: false,
    selectedFields: {},
    updatedAt: 0,
  }
}

export const useAiCacheStore = defineStore('aiCache', () => {
  const entries = ref<Record<string, AiCacheEntry>>({})

  function ensureEntry<T = unknown>(key: string): AiCacheEntry<T> {
    if (!entries.value[key]) {
      entries.value[key] = createEmptyEntry<T>()
    }
    return entries.value[key] as AiCacheEntry<T>
  }

  function getEntry<T = unknown>(key: string): AiCacheEntry<T> | null {
    return (entries.value[key] as AiCacheEntry<T> | undefined) ?? null
  }

  function setResult<T>(key: string, result: T | null) {
    const entry = ensureEntry<T>(key)
    entry.result = result
    entry.updatedAt = Date.now()
  }

  function setLoading(key: string, loading: boolean) {
    const entry = ensureEntry(key)
    entry.loading = loading
  }

  function setError(key: string, error: string | null) {
    const entry = ensureEntry(key)
    entry.error = error
  }

  function setPrompt(key: string, prompt: string) {
    const entry = ensureEntry(key)
    entry.prompt = prompt
  }

  function setExpanded(key: string, expanded: boolean) {
    const entry = ensureEntry(key)
    entry.expanded = expanded
  }

  function setSelectedFields(key: string, selected: Record<string, boolean>) {
    const entry = ensureEntry(key)
    entry.selectedFields = selected
  }

  function setPartial<T>(key: string, patch: Partial<AiCacheEntry<T>>) {
    const entry = ensureEntry<T>(key)
    Object.assign(entry, patch, { updatedAt: Date.now() })
  }

  function clear(key: string) {
    delete entries.value[key]
  }

  function clearByPrefix(prefix: string) {
    for (const key of Object.keys(entries.value)) {
      if (key.startsWith(prefix)) delete entries.value[key]
    }
  }

  function clearAll() {
    entries.value = {}
  }

  return {
    entries,
    ensureEntry,
    getEntry,
    setResult,
    setLoading,
    setError,
    setPrompt,
    setExpanded,
    setSelectedFields,
    setPartial,
    clear,
    clearByPrefix,
    clearAll,
  }
})
