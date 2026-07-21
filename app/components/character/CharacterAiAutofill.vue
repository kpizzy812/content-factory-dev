<script setup lang="ts">
/**
 * CharacterAiAutofill — AI автозаполнение полей персонажа.
 * Используется в CharacterCreateModal.vue и /characters/[id].vue.
 *
 * Структура зеркалит PipelineAiAutofill, но привязана к useEntityAiSuggest
 * (composable, не Pinia editor store) — потому что персонажи живут вне
 * pipeline editor.
 */

const props = defineProps<{
  /** Текущие значения формы (для diff-preview и контекста AI) */
  currentValues: Record<string, unknown>
  /** ID приложения (нужен серверу для app-permission guard) */
  appId?: number
  /** ID персонажа или 'new' (для cacheKey) */
  entityId?: string | 'new'
  /**
   * Компактный режим (для модалки):
   *  - меньшие padding
   *  - textarea 2 строки вместо 3
   *  - collapsed by default
   */
  compact?: boolean
}>()

const emit = defineEmits<{
  apply: [fields: Record<string, unknown>]
}>()

const {
  expanded,
  prompt,
  loading,
  error,
  result,
  selectedFields,
  suggest: suggestApi,
  applySelected: pickAndReset,
  applyAll: pickAllAndReset,
  pickSelected,
  dismiss,
  history,
  historyLoading,
  loadHistory,
} = useEntityAiSuggest({
  entityType: 'character',
  entityId: computed(() => props.entityId ?? 'new'),
  appId: computed(() => props.appId),
})

const schema = computed(() => nodeFieldSchemas['character_entity'] ?? {})

function labelFor(key: string): string {
  return schema.value[key]?.label ?? key
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}

const hasSuggestions = computed(() =>
  !!result.value && Object.keys(result.value.suggestions).length > 0,
)

const totalSuggested = computed(() =>
  result.value ? Object.keys(result.value.suggestions).length : 0,
)

const selectedCount = computed(() =>
  Object.values(selectedFields.value).filter(Boolean).length,
)

function hasChanged(key: string, suggestedValue: unknown): boolean {
  const current = props.currentValues[key]
  if (current === undefined || current === null || current === '') return true
  if (Array.isArray(suggestedValue) && Array.isArray(current)) {
    return JSON.stringify([...suggestedValue].sort()) !== JSON.stringify([...current].sort())
  }
  return String(current) !== String(suggestedValue)
}

async function generate() {
  if (!prompt.value.trim()) return
  await suggestApi(props.currentValues)
}

function applySelected() {
  const fields = pickAndReset()
  if (Object.keys(fields).length > 0) {
    emit('apply', fields)
  }
}

function applyAll() {
  const fields = pickAllAndReset()
  if (Object.keys(fields).length > 0) {
    emit('apply', fields)
  }
}

function applyHistoryItem(item: { suggestions: Record<string, unknown> | null }) {
  if (!item.suggestions) return
  emit('apply', item.suggestions)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    generate()
  }
  if (e.key === 'Escape') {
    expanded.value = false
  }
}

const showHistory = ref(false)
function toggleHistory() {
  showHistory.value = !showHistory.value
  if (showHistory.value && history.value.length === 0 && !historyLoading.value) {
    loadHistory()
  }
}

const textareaRows = computed(() => (props.compact ? 2 : 3))
const containerPaddingX = computed(() => (props.compact ? 'px-2.5' : 'px-3'))
const containerPaddingY = computed(() => (props.compact ? 'pb-2.5' : 'pb-3'))
</script>

<template>
  <div class="border border-primary/20 rounded-box overflow-hidden">
    <button
      type="button"
      class="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-primary/5 transition-colors"
      :class="expanded ? 'bg-primary/5 text-primary' : 'text-base-content/70'"
      @click="expanded = !expanded"
    >
      <Icon name="mingcute:sparkles-2-line" class="text-sm text-primary" />
      AI-автозаполнение полей
      <Icon
        :name="expanded ? 'mingcute:up-line' : 'mingcute:down-line'"
        class="ml-auto text-xs text-base-content/40"
      />
    </button>

    <Transition name="panel">
      <div v-if="expanded" :class="['space-y-2', containerPaddingX, containerPaddingY]">
        <div class="flex gap-1.5">
          <textarea
            v-model="prompt"
            class="textarea textarea-sm w-full text-xs"
            :rows="textareaRows"
            placeholder="Опишите персонажа: возраст, внешность, характер, роль. Пример: «30-летний фитнес-тренер, дружелюбный, главный герой»"
            :disabled="loading"
            @keydown="onKeydown"
          />
          <div class="tooltip tooltip-left self-end" data-tip="Сгенерировать (Ctrl+Enter)">
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

        <div
          v-if="error"
          class="rounded-box bg-error/10 border border-error/20 p-2 text-xs text-error flex items-start gap-1.5"
        >
          <Icon name="mingcute:close-circle-line" class="text-sm shrink-0 mt-0.5" />
          <div>
            <p class="font-medium">Ошибка AI</p>
            <p class="text-error/80">{{ error }}</p>
          </div>
        </div>

        <div v-if="hasSuggestions" class="space-y-2">
          <div class="flex items-center gap-1 text-xs font-medium text-base-content/70">
            <Icon name="mingcute:eye-line" class="text-sm" />
            Предпросмотр ({{ selectedCount }}/{{ totalSuggested }} выбрано)
          </div>

          <div
            v-if="result?.reasoning"
            class="rounded-box bg-info/5 border border-info/10 p-2 text-[10px] text-base-content/60"
          >
            <Icon name="mingcute:bulb-line" class="inline mr-0.5 text-info text-[10px]" />
            {{ result.reasoning }}
          </div>

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
                  <span
                    v-if="hasChanged(key as string, value)"
                    class="badge badge-xs badge-warning"
                  >
                    изменено
                  </span>
                  <span v-else class="badge badge-xs badge-ghost">
                    без изменений
                  </span>
                </div>

                <div
                  v-if="hasChanged(key as string, value) && currentValues[key as string] !== undefined && currentValues[key as string] !== null && currentValues[key as string] !== ''"
                  class="text-[10px] text-error/60 line-through mt-0.5 break-words"
                >
                  {{ formatValue(currentValues[key as string]) }}
                </div>

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
                        {{ (value as string).slice(0, 80) }}…
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

          <div
            v-if="result!.blocked?.length"
            class="rounded-box bg-warning/5 border border-warning/20 p-2 text-[10px] space-y-0.5"
          >
            <div class="flex items-center gap-1 text-warning font-medium mb-1">
              <Icon name="mingcute:shield-line" class="text-xs" />
              Заблокировано для AI
            </div>
            <div v-for="b in result!.blocked" :key="b.field" class="text-base-content/50">
              <span class="font-medium">{{ b.label }}:</span> {{ b.reason }}
            </div>
          </div>

          <div
            v-if="result!.rejected?.length"
            class="rounded-box bg-error/5 border border-error/10 p-2 text-[10px] space-y-0.5"
          >
            <div class="flex items-center gap-1 text-error/80 font-medium mb-1">
              <Icon name="mingcute:alert-line" class="text-xs" />
              Отклонено при валидации
            </div>
            <div v-for="r in result!.rejected" :key="r.field" class="text-base-content/50">
              <span class="font-medium">{{ r.field }}:</span> {{ r.reason }}
            </div>
          </div>

          <div class="flex gap-1.5 flex-wrap">
            <button
              class="btn btn-primary btn-sm flex-1"
              :disabled="selectedCount === 0"
              @click="applySelected"
            >
              <Icon name="mingcute:check-line" />
              Применить выбранные ({{ selectedCount }})
            </button>
            <button class="btn btn-outline btn-sm" @click="applyAll">
              Всё
            </button>
            <div class="tooltip tooltip-left" data-tip="Отклонить предложения AI">
              <button class="btn btn-ghost btn-sm btn-square" @click="dismiss">
                <Icon name="mingcute:close-line" />
              </button>
            </div>
          </div>
        </div>

        <div
          v-else-if="result && !hasSuggestions"
          class="rounded-box bg-warning/5 border border-warning/20 p-2 text-xs text-base-content/60"
        >
          <Icon name="mingcute:information-line" class="inline mr-1 text-warning" />
          AI не смог предложить безопасные значения.
          <span v-if="result.reasoning" class="block mt-1 text-[10px]">{{ result.reasoning }}</span>
        </div>

        <!-- История последних запросов (best-effort) -->
        <div class="pt-1 border-t border-base-300/40">
          <button
            type="button"
            class="text-[10px] text-base-content/60 hover:text-primary flex items-center gap-1"
            @click="toggleHistory"
          >
            <Icon
              :name="showHistory ? 'mingcute:up-line' : 'mingcute:down-line'"
              class="text-[10px]"
            />
            История последних запросов
          </button>
          <div v-if="showHistory" class="mt-1 space-y-1">
            <div v-if="historyLoading" class="flex items-center gap-1 text-[10px] text-base-content/50">
              <span class="loading loading-spinner loading-xs" />
              Загрузка истории…
            </div>
            <div v-else-if="history.length === 0" class="text-[10px] text-base-content/40 italic">
              Пока пусто.
            </div>
            <ul v-else class="space-y-0.5">
              <li
                v-for="item in history"
                :key="item.id"
                class="text-[10px] text-base-content/70 p-1 rounded hover:bg-base-200/50 flex items-start gap-1"
              >
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-square shrink-0"
                  :disabled="!item.suggestions"
                  :title="item.suggestions ? 'Применить это предложение' : 'Не было применимых полей'"
                  @click="applyHistoryItem(item)"
                >
                  <Icon name="mingcute:refresh-3-line" class="text-[10px]" />
                </button>
                <div class="flex-1 min-w-0">
                  <div class="truncate">{{ item.prompt }}</div>
                  <div class="text-[9px] text-base-content/40">
                    {{ new Date(item.createdAt).toLocaleString('ru-RU') }} — {{ item.status }}
                  </div>
                </div>
              </li>
            </ul>
          </div>
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
  max-height: 800px;
}
</style>
