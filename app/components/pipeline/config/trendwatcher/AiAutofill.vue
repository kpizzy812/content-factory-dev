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

function diffLines(sug: Suggestion): Array<{ field: string, label: string, before: string, after: string }> {
  const out: Array<{ field: string, label: string, before: string, after: string }> = []
  const fmt = (v: unknown): string => {
    if (v == null || v === '') return '—'
    if (Array.isArray(v)) return v.join(', ')
    return String(v)
  }
  const fields: Array<[keyof Suggestion, string]> = [
    ['appId', 'Приложение (id)'],
    ['actorId', 'Актор'],
    ['platforms', 'Платформы'],
    ['keywords', 'Ключевые слова'],
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
  <div class="flex flex-col gap-2 rounded-lg border border-accent-border bg-accent-bg p-3">
    <div class="flex items-center gap-1.5 font-medium text-accent-text">
      <Icon name="mingcute:ai-line" />
      AI-автозаполнение всего блока
    </div>

    <UiTextarea
      v-model="prompt"
      :rows="2"
      :disabled="loading"
      placeholder="Опиши цель парсинга — например: «собирать TikTok-тренды про домашний фитнес в США с 500K+ просмотров»"
    />

    <div class="flex items-center justify-between gap-2">
      <p class="text-micro text-muted">
        <template v-if="!appId">Приложение не выбрано — укажите его в промте словами, AI справится без подгруженного контекста.</template>
        <template v-else>AI подберёт актор, ключевые слова, гео и пороги по контексту приложения.</template>
      </p>
      <UiButton variant="primary" :disabled="!canRun" :loading="loading" @click="run">
        <Icon v-if="!loading" name="mingcute:send-plane-line" />
        Сгенерировать
      </UiButton>
    </div>

    <p
      v-if="errorText"
      class="rounded-md border border-danger-border bg-danger-bg px-2 py-1.5 text-sm text-danger"
    >
      {{ errorText }}
    </p>

    <div v-if="preview" class="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
      <p v-if="preview.reasoning" class="text-sm text-muted italic">
        {{ preview.reasoning }}
      </p>

      <div v-if="previewDiff.length" class="flex flex-col gap-1">
        <div class="text-micro font-medium tracking-wide text-subtle uppercase">
          Изменения
        </div>
        <div
          v-for="row in previewDiff"
          :key="row.field"
          class="grid grid-cols-[1fr_auto_1fr] items-start gap-2 text-sm"
        >
          <div>
            <div class="text-subtle">{{ row.label }}</div>
            <div class="text-muted line-through decoration-danger">{{ row.before }}</div>
          </div>
          <Icon name="mingcute:arrow-right-line" class="mt-4 text-subtle" />
          <div>
            <div class="text-subtle">&nbsp;</div>
            <div class="font-medium text-success">{{ row.after }}</div>
          </div>
        </div>
      </div>
      <p v-else class="text-sm text-muted">
        AI не предложил изменений к текущему конфигу.
      </p>

      <div class="flex justify-end gap-1.5 pt-1">
        <UiButton variant="ghost" @click="dismissPreview">Отклонить</UiButton>
        <UiButton variant="primary" :disabled="!previewDiff.length" @click="applyPreview">
          Применить
        </UiButton>
      </div>
    </div>
  </div>
</template>
