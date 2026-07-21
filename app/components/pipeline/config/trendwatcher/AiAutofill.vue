<script setup lang="ts">
/**
 * Block-level AI autofill для trendwatcher node.
 * Вызывает /api/ai/suggest/trendwatcher-config и показывает diff-preview перед применением.
 */
const props = defineProps<{
  appId: number | null
  currentConfig: Record<string, unknown>
  pipelineId?: number
  nodeCanvasId?: string
}>()

const emit = defineEmits<{
  apply: [suggestion: Record<string, unknown>]
}>()

interface Suggestion {
  appId?: number
  actorId?: string
  platforms?: string[]
  keywords?: string[]
  geo?: string
  language?: string
  viewCountMin?: number | null
  viewCountMax?: number | null
  maxItems?: number
  name?: string
  preset?: string | null
  reasoning?: string
  auditId?: number
}

const aiCache = useAiCacheStore()

const cacheKey = computed(() => {
  const pid = props.pipelineId ?? 'draft'
  const nid = props.nodeCanvasId ?? 'unknown'
  return `trendwatcher:${pid}:${nid}`
})

watchEffect(() => {
  aiCache.ensureEntry<Suggestion>(cacheKey.value)
})

const prompt = computed<string>({
  get: () => aiCache.getEntry(cacheKey.value)?.prompt ?? '',
  set: v => aiCache.setPrompt(cacheKey.value, v),
})
const loading = computed<boolean>({
  get: () => aiCache.getEntry(cacheKey.value)?.loading ?? false,
  set: v => aiCache.setLoading(cacheKey.value, v),
})
const preview = computed<Suggestion | null>({
  get: () => aiCache.getEntry<Suggestion>(cacheKey.value)?.result ?? null,
  set: v => aiCache.setResult<Suggestion>(cacheKey.value, v),
})
const errorText = computed<string>({
  get: () => aiCache.getEntry(cacheKey.value)?.error ?? '',
  set: v => aiCache.setError(cacheKey.value, v || null),
})

// appId опционален: пользователь может указать приложение прямо в промте.
// AI endpoint работает без appId — просто без подгруженного контекста из БД.
const canRun = computed(() => prompt.value.trim().length > 0)

async function run() {
  if (!canRun.value) return
  loading.value = true
  errorText.value = ''
  preview.value = null
  try {
    const res = await $fetch<{ data: Suggestion }>('/api/ai/suggest/trendwatcher-config', {
      method: 'POST',
      body: {
        prompt: prompt.value.trim(),
        appId: props.appId,
        currentConfig: props.currentConfig,
        pipelineId: props.pipelineId,
        nodeCanvasId: props.nodeCanvasId,
      },
    })
    preview.value = res.data
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : 'Не удалось получить подсказку от AI'
  } finally {
    loading.value = false
  }
}

function diffLines(sug: Suggestion): Array<{ field: string; label: string; before: string; after: string }> {
  const out: Array<{ field: string; label: string; before: string; after: string }> = []
  const fmt = (v: unknown): string => {
    if (v == null || v === '') return '—'
    if (Array.isArray(v)) return v.join(', ')
    return String(v)
  }
  const fields: Array<[keyof Suggestion, string]> = [
    ['appId', 'Приложение (id)'],
    ['actorId', 'Актор'],
    ['platforms', 'Платформы'],
    ['keywords', 'Keywords'],
    ['geo', 'Гео'],
    ['language', 'Язык'],
    ['viewCountMin', 'Мин. просмотров'],
    ['viewCountMax', 'Макс. просмотров'],
    ['maxItems', 'Макс. результатов'],
    ['preset', 'Стратегия'],
    ['name', 'Имя (inline)'],
  ]
  for (const [key, label] of fields) {
    if (sug[key] === undefined) continue
    const before = fmt(props.currentConfig[key as string])
    const after = fmt(sug[key])
    if (before === after) continue
    out.push({ field: String(key), label, before, after })
  }
  return out
}

const previewDiff = computed(() => (preview.value ? diffLines(preview.value) : []))

function applyPreview() {
  if (!preview.value) return
  const payload: Record<string, unknown> = {}
  const allowedKeys = [
    'appId', 'actorId', 'platforms', 'keywords', 'geo', 'language',
    'viewCountMin', 'viewCountMax', 'maxItems', 'preset',
  ]
  for (const k of allowedKeys) {
    if ((preview.value as Record<string, unknown>)[k] !== undefined) {
      payload[k] = (preview.value as Record<string, unknown>)[k]
    }
  }
  if (preview.value.name && !props.currentConfig.inlineName) {
    payload.inlineName = preview.value.name
  }
  emit('apply', payload)
  preview.value = null
  prompt.value = ''
}

function dismissPreview() {
  preview.value = null
}
</script>

<template>
  <div class="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
    <div class="flex items-center gap-1.5 text-xs font-medium text-primary">
      <Icon name="mingcute:ai-line" />
      AI-автозаполнение всего блока
    </div>

    <textarea
      v-model="prompt"
      rows="2"
      class="textarea textarea-sm w-full"
      placeholder="Опиши цель парсинга — например: «собирать TikTok-тренды про домашний фитнес в США с 500K+ просмотров»"
      :disabled="loading"
    />

    <div class="flex items-center justify-between gap-2">
      <div class="text-xs text-base-content/60">
        <template v-if="!appId">Приложение не выбрано — укажите его в промте словами, AI справится без подгруженного контекста.</template>
        <template v-else>AI подберёт актор, keywords, гео, пороги по контексту приложения.</template>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        :disabled="!canRun || loading"
        @click="run"
      >
        <span v-if="loading" class="loading loading-spinner loading-xs" />
        <Icon v-else name="mingcute:send-plane-line" />
        Сгенерировать
      </button>
    </div>

    <div v-if="errorText" class="alert alert-error py-1.5 px-2 text-xs">
      {{ errorText }}
    </div>

    <div v-if="preview" class="rounded-md bg-base-100 border border-base-300 p-2 space-y-2">
      <div v-if="preview.reasoning" class="text-xs text-base-content/70 italic">
        {{ preview.reasoning }}
      </div>

      <div v-if="previewDiff.length" class="space-y-1">
        <div class="text-[11px] font-medium text-base-content/60 uppercase tracking-wide">
          Изменения
        </div>
        <div
          v-for="row in previewDiff"
          :key="row.field"
          class="text-xs grid grid-cols-[1fr_auto_1fr] gap-2 items-start"
        >
          <div>
            <div class="text-base-content/50">
              {{ row.label }}
            </div>
            <div class="text-base-content/70 line-through decoration-error/50">
              {{ row.before }}
            </div>
          </div>
          <Icon name="mingcute:arrow-right-line" class="mt-4 text-base-content/40" />
          <div>
            <div class="text-base-content/50">&nbsp;</div>
            <div class="text-success font-medium">
              {{ row.after }}
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-xs text-base-content/60">
        AI не предложил изменений к текущему конфигу.
      </div>

      <div class="flex justify-end gap-1.5 pt-1">
        <button type="button" class="btn btn-xs btn-ghost" @click="dismissPreview">
          Отклонить
        </button>
        <button
          type="button"
          class="btn btn-xs btn-primary"
          :disabled="!previewDiff.length"
          @click="applyPreview"
        >
          Применить
        </button>
      </div>
    </div>
  </div>
</template>
