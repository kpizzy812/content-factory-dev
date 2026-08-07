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

const BADGE = 'inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro'
const NEUTRAL_TONE = 'border-neutral-border bg-neutral-bg text-neutral'
</script>

<template>
  <div class="overflow-hidden rounded-md border border-accent-border">
    <!-- Заголовок-переключатель -->
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 font-medium transition-colors duration-(--duration-fast) ease-out hover:bg-accent-bg"
      :class="expanded ? 'bg-accent-bg text-accent-text' : 'text-muted'"
      @click="expanded = !expanded"
    >
      <Icon name="mingcute:sparkles-2-line" class="text-accent-text" />
      AI автозаполнение
      <Icon :name="expanded ? 'mingcute:up-line' : 'mingcute:down-line'" class="ml-auto text-subtle" />
    </button>

    <Transition name="panel">
      <div v-if="expanded" class="flex flex-col gap-2 px-3 pb-3">
        <!-- Промт -->
        <div class="flex gap-1.5">
          <UiTextarea
            v-model="prompt"
            :rows="2"
            :disabled="loading"
            class="flex-1"
            placeholder="Опишите задачу: что должен делать этот блок? Например: «Искать тренды фитнеса в TikTok для русской аудитории»"
            @keydown="onKeydown"
          />
          <UiTooltip text="Отправить запрос к AI" placement="left" class="self-end">
            <UiButton
              variant="primary"
              icon-only
              size="md"
              :disabled="!prompt.trim()"
              :loading="loading"
              @click="generate"
            >
              <Icon v-if="!loading" name="mingcute:send-line" />
            </UiButton>
          </UiTooltip>
        </div>

        <!-- Ошибка -->
        <div
          v-if="error"
          class="flex items-start gap-1.5 rounded-md border border-danger-border bg-danger-bg p-2 text-danger"
        >
          <Icon name="mingcute:close-circle-line" class="mt-0.5 shrink-0" />
          <div>
            <p class="font-medium">Ошибка</p>
            <p class="text-sm">{{ error }}</p>
          </div>
        </div>

        <!-- Предпросмотр -->
        <div v-if="hasSuggestions" class="flex flex-col gap-2">
          <div class="flex items-center gap-1 font-medium text-muted">
            <Icon name="mingcute:eye-line" />
            Предпросмотр ({{ selectedCount }} из {{ Object.keys(result!.suggestions).length }} выбрано)
          </div>

          <p
            v-if="result!.reasoning"
            class="flex items-start gap-1.5 rounded-md border border-info-border bg-info-bg p-2 text-micro text-muted"
          >
            <Icon name="mingcute:bulb-line" class="mt-0.5 shrink-0 text-info" />
            {{ result!.reasoning }}
          </p>

          <!-- Поля с разницей -->
          <div class="flex flex-col gap-1">
            <label
              v-for="(value, key) in result!.suggestions"
              :key="key"
              class="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-raised"
            >
              <input
                v-model="selectedFields[key as string]"
                type="checkbox"
                class="mt-0.5 size-3.5 shrink-0 rounded-sm accent-(--color-accent)"
              >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1 font-medium text-fg">
                  <span>{{ labelFor(key as string) }}</span>
                  <span class="font-mono text-micro text-subtle">{{ key }}</span>
                  <span
                    v-if="hasChanged(key as string, value)"
                    :class="[BADGE, 'border-warning-border bg-warning-bg text-warning']"
                  >изменено</span>
                  <span v-else :class="[BADGE, NEUTRAL_TONE]">без изменений</span>
                </div>

                <div
                  v-if="hasChanged(key as string, value) && config[key as string] !== undefined && config[key as string] !== null && config[key as string] !== ''"
                  class="mt-0.5 text-micro text-muted line-through decoration-danger"
                >
                  {{ formatValue(config[key as string]) }}
                </div>

                <div class="text-micro break-words text-muted">
                  <template v-if="Array.isArray(value)">
                    <span
                      v-for="(tag, i) in (value as string[])"
                      :key="i"
                      class="mr-0.5 mb-0.5 inline-block rounded-sm border border-accent-border bg-accent-bg px-1 text-accent-text"
                    >{{ tag }}</span>
                  </template>
                  <template v-else-if="typeof value === 'string' && (value as string).length > 80">
                    <details>
                      <summary class="cursor-pointer text-accent-text">
                        {{ (value as string).slice(0, 80) }}…
                        <span class="text-subtle">(развернуть)</span>
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

          <!-- Заблокированные поля -->
          <div
            v-if="result!.blocked?.length"
            class="flex flex-col gap-0.5 rounded-md border border-warning-border bg-warning-bg p-2 text-micro"
          >
            <div class="mb-1 flex items-center gap-1 font-medium text-warning">
              <Icon name="mingcute:shield-line" />
              Заблокировано для AI
            </div>
            <div v-for="b in result!.blocked" :key="b.field" class="text-muted">
              <span class="font-medium">{{ b.label }}:</span> {{ b.reason }}
            </div>
          </div>

          <!-- Отклонённые поля -->
          <div
            v-if="result!.rejected?.length"
            class="flex flex-col gap-0.5 rounded-md border border-danger-border bg-danger-bg p-2 text-micro"
          >
            <div class="mb-1 flex items-center gap-1 font-medium text-danger">
              <Icon name="mingcute:alert-line" />
              Отклонено при валидации
            </div>
            <div v-for="r in result!.rejected" :key="r.field" class="text-muted">
              <span class="font-medium">{{ r.field }}:</span> {{ r.reason }}
            </div>
          </div>

          <!-- Применить -->
          <div class="flex gap-1.5">
            <UiButton
              variant="primary"
              size="md"
              class="flex-1 justify-center"
              :disabled="selectedCount === 0"
              @click="applySelected"
            >
              <Icon name="mingcute:check-line" />
              Применить выбранные ({{ selectedCount }})
            </UiButton>
            <UiButton size="md" @click="applyAll">Всё</UiButton>
            <UiTooltip text="Отклонить предложения AI" placement="left">
              <UiButton variant="ghost" icon-only size="md" @click="dismiss">
                <Icon name="mingcute:close-line" />
              </UiButton>
            </UiTooltip>
          </div>
        </div>

        <!-- Пустой результат -->
        <div
          v-else-if="result && !hasSuggestions"
          class="rounded-md border border-warning-border bg-warning-bg p-2 text-muted"
        >
          <Icon name="mingcute:information-line" class="mr-1 inline text-warning" />
          AI не смог предложить безопасные значения для этого блока.
          <span v-if="result.reasoning" class="mt-1 block text-micro">{{ result.reasoning }}</span>
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
