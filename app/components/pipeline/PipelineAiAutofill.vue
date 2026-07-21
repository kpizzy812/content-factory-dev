<script setup lang="ts">
/**
 * Block-level AI autofill panel.
 * Пользователь описывает задачу — AI предлагает заполнение всех безопасных полей.
 * Preview before apply: diff-view текущих vs предложенных значений.
 * AI audit trail: каждое предложение и решение логируется.
 */

const props = defineProps<{
  nodeType: string
  config: Record<string, any>
}>()

const store = usePipelineEditorStore()
const aiCache = useAiCacheStore()

const emit = defineEmits<{
  apply: [fields: Record<string, unknown>]
}>()

interface AutofillResult {
  auditId?: number
  suggestions: Record<string, unknown>
  blocked: Array<{ field: string; label: string; reason: string }>
  rejected: Array<{ field: string; reason: string }>
  reasoning: string
}

const cacheKey = computed(() => {
  const pid = store.pipelineId ?? 'draft'
  const nid = store.selectedNodeId ?? 'unselected'
  return `block:${pid}:${nid}`
})

watchEffect(() => {
  aiCache.ensureEntry<AutofillResult>(cacheKey.value)
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
const result = computed<AutofillResult | null>({
  get: () => aiCache.getEntry<AutofillResult>(cacheKey.value)?.result ?? null,
  set: v => aiCache.setResult<AutofillResult>(cacheKey.value, v),
})
const selectedFields = computed<Record<string, boolean>>({
  get: () => aiCache.getEntry(cacheKey.value)?.selectedFields ?? {},
  set: v => aiCache.setSelectedFields(cacheKey.value, v),
})

const schema = computed(() => nodeFieldSchemas[props.nodeType] ?? {})

// Глобальная карта переводов технических ключей - для случаев когда поле
// не описано в nodeFieldSchemas (AI вернула unknown-key из-за обновления
// схемы блока). Без неё в UI выпадают голые английские camelCase-переменные
// типа "videoModelId", "sceneCount" - непонятно что это.
const COMMON_KEY_LABELS: Record<string, string> = {
  imageModelId: 'Модель изображений',
  videoModelId: 'Модель видео',
  voiceoverModelId: 'Модель TTS',
  sceneCount: 'Количество сцен',
  clipDuration: 'Длительность клипа',
  generateAudio: 'Аудио в клипах',
  modelStrategy: 'Стратегия моделей',
  enableMusic: 'Музыка',
  musicMood: 'Настроение музыки',
  musicVolume: 'Громкость музыки',
  musicVolumeWithVoiceover: 'Громкость музыки при озвучке',
  voiceoverEnabled: 'Озвучка',
  voiceoverLanguage: 'Язык озвучки',
  voiceoverVoiceId: 'ID голоса',
  voiceoverPacing: 'Темп озвучки',
  voiceoverReconciliation: 'Стратегия согласования озвучки',
  subtitlesEnabled: 'Субтитры',
  subtitlePreset: 'Пресет субтитров',
  maxVideos: 'Лимит видео',
  maxItems: 'Макс. результатов',
  maxTrends: 'Лимит трендов',
  targetPlatform: 'Целевая платформа',
  format: 'Формат',
  quality: 'Качество',
  keywords: 'Ключевые слова',
  geo: 'Гео',
  language: 'Язык',
  variantsCount: 'Количество вариантов',
  generationMode: 'Режим генерации',
  contextMode: 'Режим контекста приложения',
  appId: 'Приложение',
}

/**
 * Разбивает camelCase/dotted ключ на человекочитаемый текст. Используется как
 * последний fallback, когда ключа нет ни в schema ни в COMMON_KEY_LABELS.
 * Пример: "storytelling.sceneCountStrategy" → "Storytelling · scene count strategy".
 */
function humanizeKey(key: string): string {
  if (!key) return key
  const parts = key.split('.')
  const humanized = parts
    .map(part => part
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, c => c.toUpperCase())
      .trim(),
    )
    .join(' · ')
  return humanized
}

function labelFor(key: string): string {
  return schema.value[key]?.label
    ?? COMMON_KEY_LABELS[key]
    ?? humanizeKey(key)
}

async function generate() {
  if (!prompt.value.trim()) return
  loading.value = true
  error.value = null
  result.value = null

  try {
    const res = await $fetch<{ data: AutofillResult }>('/api/ai/suggest/block', {
      method: 'POST',
      body: {
        nodeType: props.nodeType,
        prompt: prompt.value.trim(),
        currentConfig: props.config,
        pipelineId: store.pipelineId ?? undefined,
        nodeCanvasId: store.selectedNodeId ?? undefined,
      },
    })
    result.value = res.data

    const sel: Record<string, boolean> = {}
    for (const key of Object.keys(res.data.suggestions)) {
      sel[key] = true
    }
    selectedFields.value = sel
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Ошибка AI-сервиса'
  } finally {
    loading.value = false
  }
}

async function reportAuditStatus(status: 'applied' | 'partial' | 'dismissed', appliedFields?: Record<string, unknown>) {
  if (!result.value?.auditId) return
  try {
    await $fetch('/api/ai/audit', {
      method: 'PUT',
      body: {
        auditId: result.value.auditId,
        status,
        appliedFields,
      },
    })
  } catch {
    // Audit logging не должен блокировать UX
  }
}

function applySelected() {
  if (!result.value) return
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(result.value.suggestions)) {
    if (selectedFields.value[key]) {
      fields[key] = value
    }
  }
  const allSelected = selectedCount.value === Object.keys(result.value.suggestions).length
  reportAuditStatus(allSelected ? 'applied' : 'partial', fields)
  emit('apply', fields)
  result.value = null
  prompt.value = ''
  expanded.value = false
}

function applyAll() {
  if (!result.value) return
  reportAuditStatus('applied', result.value.suggestions)
  emit('apply', result.value.suggestions)
  result.value = null
  prompt.value = ''
  expanded.value = false
}

function dismiss() {
  reportAuditStatus('dismissed')
  result.value = null
  error.value = null
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    generate()
  }
  if (e.key === 'Escape') {
    expanded.value = false
  }
}

const hasSuggestions = computed(() =>
  result.value && Object.keys(result.value.suggestions).length > 0,
)

const selectedCount = computed(() =>
  Object.values(selectedFields.value).filter(Boolean).length,
)

/** Проверяет, отличается ли предложенное значение от текущего */
function hasChanged(key: string, suggestedValue: unknown): boolean {
  const current = props.config[key]
  if (current === undefined || current === null || current === '') return true
  if (Array.isArray(suggestedValue) && Array.isArray(current)) {
    return JSON.stringify([...suggestedValue].sort()) !== JSON.stringify([...current].sort())
  }
  return String(current) !== String(suggestedValue)
}
</script>

<template>
  <div class="border border-primary/20 rounded-box overflow-hidden">
    <!-- Toggle header -->
    <button
      type="button"
      class="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-primary/5 transition-colors"
      :class="expanded ? 'bg-primary/5 text-primary' : 'text-base-content/70'"
      @click="expanded = !expanded"
    >
      <Icon name="mingcute:sparkles-2-line" class="text-sm text-primary" />
      AI автозаполнение
      <Icon
        :name="expanded ? 'mingcute:up-line' : 'mingcute:down-line'"
        class="ml-auto text-xs text-base-content/40"
      />
    </button>

    <!-- Content -->
    <Transition name="panel">
      <div v-if="expanded" class="px-3 pb-3 space-y-2">
        <!-- Prompt input -->
        <div class="flex gap-1.5">
          <textarea
            v-model="prompt"
            class="textarea textarea-sm w-full text-xs"
            rows="2"
            placeholder="Опишите задачу: что должен делать этот блок? Например: «Искать тренды фитнеса в TikTok для русской аудитории»"
            :disabled="loading"
            @keydown="onKeydown"
          />
          <div class="tooltip tooltip-left self-end" data-tip="Отправить запрос к AI">
            <button
              type="button"
              class="btn btn-primary btn-sm btn-square"
              :disabled="!prompt.trim() || loading"
              @click="generate"
            >
              <span v-if="loading" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:send-line" class="text-xs" />
            </button>
          </div>
        </div>

        <!-- Error -->
        <div v-if="error" class="rounded-box bg-error/10 border border-error/20 p-2 text-xs text-error flex items-start gap-1.5">
          <Icon name="mingcute:close-circle-line" class="text-sm shrink-0 mt-0.5" />
          <div>
            <p class="font-medium">Ошибка</p>
            <p class="text-error/80">{{ error }}</p>
          </div>
        </div>

        <!-- Preview: suggestions with diff -->
        <div v-if="hasSuggestions" class="space-y-2">
          <div class="flex items-center gap-1 text-xs font-medium text-base-content/70">
            <Icon name="mingcute:eye-line" class="text-sm" />
            Предпросмотр ({{ selectedCount }}/{{ Object.keys(result!.suggestions).length }} выбрано)
          </div>

          <!-- Reasoning -->
          <div v-if="result!.reasoning" class="rounded-box bg-info/5 border border-info/10 p-2 text-[10px] text-base-content/60">
            <Icon name="mingcute:bulb-line" class="inline mr-0.5 text-info text-[10px]" />
            {{ result!.reasoning }}
          </div>

          <!-- Fields preview with diff -->
          <div class="space-y-1">
            <label
              v-for="(value, key) in result!.suggestions"
              :key="key"
              class="flex items-start gap-2 p-1.5 rounded hover:bg-base-200/50 cursor-pointer"
            >
              <input
                v-model="selectedFields[key as string]"
                type="checkbox"
                class="checkbox checkbox-xs checkbox-primary mt-0.5"
              />
              <div class="flex-1 min-w-0">
                <div class="text-[11px] font-medium text-base-content/80 flex items-center gap-1 flex-wrap">
                  <span>{{ labelFor(key as string) }}</span>
                  <span class="text-[9px] font-mono text-base-content/40">{{ key }}</span>
                  <span
                    v-if="hasChanged(key as string, value)"
                    class="badge badge-xs badge-warning"
                  >
                    изменено
                  </span>
                  <span
                    v-else
                    class="badge badge-xs badge-ghost"
                  >
                    без изменений
                  </span>
                </div>

                <!-- Diff: current value -->
                <div
                  v-if="hasChanged(key as string, value) && config[key as string] !== undefined && config[key as string] !== null && config[key as string] !== ''"
                  class="text-[10px] text-error/60 line-through mt-0.5"
                >
                  {{ formatValue(config[key as string]) }}
                </div>

                <!-- Suggested value -->
                <div class="text-[10px] text-base-content/60 break-words">
                  <template v-if="Array.isArray(value)">
                    <span
                      v-for="(tag, i) in (value as string[])"
                      :key="i"
                      class="inline-block bg-primary/10 text-primary rounded px-1 py-0.5 mr-0.5 mb-0.5"
                    >
                      {{ tag }}
                    </span>
                  </template>
                  <template v-else-if="typeof value === 'string' && (value as string).length > 80">
                    <details class="group">
                      <summary class="cursor-pointer text-primary/70 hover:text-primary">
                        {{ (value as string).slice(0, 80) }}...
                        <span class="text-[9px]">(развернуть)</span>
                      </summary>
                      <p class="mt-1 whitespace-pre-wrap">{{ value }}</p>
                    </details>
                  </template>
                  <template v-else>
                    {{ formatValue(value) }}
                  </template>
                </div>
              </div>
            </label>
          </div>

          <!-- Blocked fields info -->
          <div v-if="result!.blocked?.length" class="rounded-box bg-warning/5 border border-warning/20 p-2 text-[10px] space-y-0.5">
            <div class="flex items-center gap-1 text-warning font-medium mb-1">
              <Icon name="mingcute:shield-line" class="text-xs" />
              Заблокировано для AI
            </div>
            <div v-for="b in result!.blocked" :key="b.field" class="text-base-content/50">
              <span class="font-medium">{{ b.label }}:</span> {{ b.reason }}
            </div>
          </div>

          <!-- Rejected fields -->
          <div v-if="result!.rejected?.length" class="rounded-box bg-error/5 border border-error/10 p-2 text-[10px] space-y-0.5">
            <div class="flex items-center gap-1 text-error/80 font-medium mb-1">
              <Icon name="mingcute:alert-line" class="text-xs" />
              Отклонено при валидации
            </div>
            <div v-for="r in result!.rejected" :key="r.field" class="text-base-content/50">
              <span class="font-medium">{{ r.field }}:</span> {{ r.reason }}
            </div>
          </div>

          <!-- Apply buttons -->
          <div class="flex gap-1.5">
            <button
              class="btn btn-primary btn-sm flex-1"
              :disabled="selectedCount === 0"
              @click="applySelected"
            >
              <Icon name="mingcute:check-line" />
              Применить выбранные ({{ selectedCount }})
            </button>
            <button
              class="btn btn-outline btn-sm"
              @click="applyAll"
            >
              Всё
            </button>
            <div class="tooltip tooltip-left" data-tip="Отклонить предложения AI">
              <button class="btn btn-ghost btn-sm btn-square" @click="dismiss">
                <Icon name="mingcute:close-line" />
              </button>
            </div>
          </div>
        </div>

        <!-- Empty result -->
        <div
          v-else-if="result && !hasSuggestions"
          class="rounded-box bg-warning/5 border border-warning/20 p-2 text-xs text-base-content/60"
        >
          <Icon name="mingcute:information-line" class="inline mr-1 text-warning" />
          AI не смог предложить безопасные значения для этого блока.
          <span v-if="result.reasoning" class="block mt-1 text-[10px]">{{ result.reasoning }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.15s ease, max-height 0.2s ease;
  overflow: hidden;
}
.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  max-height: 0;
}
.panel-enter-to,
.panel-leave-from {
  max-height: 600px;
}
</style>
