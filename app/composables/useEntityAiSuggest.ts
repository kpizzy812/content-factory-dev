/**
 * useEntityAiSuggest — composable для AI-автозаполнения полей сущностей
 * Character и Scene на странице/в модалке (не привязан к pipeline editor).
 *
 * Зеркалит API PipelineAiAutofill (через useAiCacheStore):
 *  - prompt / expanded / loading / error / result / selectedFields через cache
 *  - suggest(currentValues) — POST /api/ai/suggest/entity
 *  - applyAll() / applySelected() — выбор полей для emit'а наружу
 *  - dismiss() / reset()
 *  - history — последние 5 предложений из /api/ai/audit (best-effort)
 */

import type { MaybeRefOrGetter } from 'vue'

export interface EntityAiResult {
  auditId?: number
  suggestions: Record<string, unknown>
  blocked: Array<{ field: string; label: string; reason: string }>
  rejected: Array<{ field: string; reason: string }>
  reasoning: string
}

export interface EntityAiHistoryItem {
  id: number
  prompt: string
  suggestions: Record<string, unknown> | null
  createdAt: string
  status: string
}

export interface UseEntityAiSuggestOptions {
  entityType: 'character' | 'scene'
  /** Идентификатор сущности (numeric ID или 'new' для create-режима) */
  entityId: MaybeRefOrGetter<string | number | 'new'>
  /** ID приложения — пробрасывается на сервер для контекста и app-permission guard */
  appId?: MaybeRefOrGetter<number | undefined>
}

export function useEntityAiSuggest(options: UseEntityAiSuggestOptions) {
  const aiCache = useAiCacheStore()

  const cacheKey = computed(() => {
    const id = toValue(options.entityId)
    return `entity:${options.entityType}:${id ?? 'new'}`
  })

  // Гарантируем что entry в кэше существует — иначе reactive геттеры вернут default
  watchEffect(() => {
    aiCache.ensureEntry<EntityAiResult>(cacheKey.value)
  })

  const expanded = computed<boolean>({
    get: () => aiCache.getEntry(cacheKey.value)?.expanded ?? false,
    set: v => aiCache.setExpanded(cacheKey.value, v),
  })

  const prompt = computed<string>({
    get: () => aiCache.getEntry(cacheKey.value)?.prompt ?? '',
    set: v => aiCache.setPrompt(cacheKey.value, v),
  })

  const loading = computed<boolean>({
    get: () => aiCache.getEntry(cacheKey.value)?.loading ?? false,
    set: v => aiCache.setLoading(cacheKey.value, v),
  })

  const error = computed<string | null>({
    get: () => aiCache.getEntry(cacheKey.value)?.error ?? null,
    set: v => aiCache.setError(cacheKey.value, v),
  })

  const result = computed<EntityAiResult | null>({
    get: () => aiCache.getEntry<EntityAiResult>(cacheKey.value)?.result ?? null,
    set: v => aiCache.setResult<EntityAiResult>(cacheKey.value, v),
  })

  const selectedFields = computed<Record<string, boolean>>({
    get: () => aiCache.getEntry(cacheKey.value)?.selectedFields ?? {},
    set: v => aiCache.setSelectedFields(cacheKey.value, v),
  })

  const suggestions = computed<Record<string, unknown>>(
    () => result.value?.suggestions ?? {},
  )

  // ── History (best-effort GET /api/ai/audit) ──────────────────────────────
  const history = ref<EntityAiHistoryItem[]>([])
  const historyLoading = ref(false)
  const historyError = ref<string | null>(null)

  async function loadHistory() {
    historyLoading.value = true
    historyError.value = null
    try {
      const nodeType = options.entityType === 'character' ? 'character_entity' : 'scene_entity'
      const res = await $fetch<{ data: Array<{
        id: number
        prompt: string
        suggestions: Record<string, unknown> | null
        createdAt: string
        status: string
      }> }>('/api/ai/audit', {
        params: { nodeType, limit: 5 },
      })
      history.value = res.data.map(r => ({
        id: r.id,
        prompt: r.prompt,
        suggestions: r.suggestions,
        createdAt: r.createdAt,
        status: r.status,
      }))
    } catch (e: unknown) {
      // best-effort — если нет прав на модуль pipeline (audit.get требует это),
      // не показываем ошибку, просто оставляем пустую историю.
      historyError.value = (e as { data?: { message?: string }; message?: string })?.data?.message
        ?? (e as { message?: string })?.message
        ?? null
      history.value = []
    } finally {
      historyLoading.value = false
    }
  }

  // ── Core action: запрос предложений ──────────────────────────────────────
  async function suggest(currentValues?: Record<string, unknown>): Promise<EntityAiResult | null> {
    if (!prompt.value.trim()) return null

    loading.value = true
    error.value = null
    result.value = null

    try {
      const appIdRaw = toValue(options.appId)
      const res = await $fetch<{ data: EntityAiResult }>('/api/ai/suggest/entity', {
        method: 'POST',
        body: {
          entityType: options.entityType,
          prompt: prompt.value.trim(),
          currentValues: currentValues ?? {},
          ...(typeof appIdRaw === 'number' && appIdRaw > 0 ? { appId: appIdRaw } : {}),
        },
      })
      result.value = res.data

      // По умолчанию выделяем все предложенные поля
      const sel: Record<string, boolean> = {}
      for (const key of Object.keys(res.data.suggestions)) sel[key] = true
      selectedFields.value = sel

      return res.data
    } catch (e: unknown) {
      const msg = (e as { data?: { message?: string }; message?: string })?.data?.message
        ?? (e as { message?: string })?.message
        ?? 'Ошибка AI-сервиса'
      error.value = msg
      return null
    } finally {
      loading.value = false
    }
  }

  // ── Audit status reporting ───────────────────────────────────────────────
  async function reportAuditStatus(
    status: 'applied' | 'partial' | 'dismissed',
    appliedFields?: Record<string, unknown>,
  ) {
    const auditId = result.value?.auditId
    if (!auditId) return
    try {
      await $fetch('/api/ai/audit', {
        method: 'PUT',
        body: { auditId, status, appliedFields },
      })
    } catch {
      // audit не должен блокировать UX
    }
  }

  // ── Apply / dismiss handlers ─────────────────────────────────────────────
  /**
   * Возвращает только выбранные поля (для emit('apply', fields)).
   * Не очищает state сам — родитель решает что делать после.
   */
  function pickSelected(): Record<string, unknown> {
    const r = result.value
    if (!r) return {}
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(r.suggestions)) {
      if (selectedFields.value[key]) out[key] = value
    }
    return out
  }

  function applySelected(): Record<string, unknown> {
    const r = result.value
    if (!r) return {}
    const fields = pickSelected()
    const totalSuggested = Object.keys(r.suggestions).length
    const totalSelected = Object.keys(fields).length
    const status: 'applied' | 'partial' = totalSelected === totalSuggested ? 'applied' : 'partial'
    void reportAuditStatus(status, fields)
    result.value = null
    prompt.value = ''
    return fields
  }

  function applyAll(): Record<string, unknown> {
    const r = result.value
    if (!r) return {}
    const fields = { ...r.suggestions }
    void reportAuditStatus('applied', fields)
    result.value = null
    prompt.value = ''
    return fields
  }

  function dismiss() {
    void reportAuditStatus('dismissed')
    result.value = null
    error.value = null
  }

  function reset() {
    aiCache.clear(cacheKey.value)
  }

  return {
    // state
    cacheKey,
    expanded,
    prompt,
    loading,
    error,
    result,
    suggestions,
    selectedFields,
    // actions
    suggest,
    applySelected,
    applyAll,
    pickSelected,
    dismiss,
    reset,
    // history
    history,
    historyLoading,
    historyError,
    loadHistory,
  }
}
