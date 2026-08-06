<script setup lang="ts">
/**
 * AI-автозаполнение полей персонажа: промпт → предложения по полям → выбор.
 * Устройство зеркалит PipelineAiAutofill, но данные берёт из useEntityAiSuggest —
 * персонажи живут вне редактора конвейера.
 *
 * Предложения не применяются молча: у каждого поля видно, меняется ли значение,
 * и что было до правки.
 */
const props = defineProps<{
  /** Текущие значения формы — идут в контекст AI и в сравнение «было / стало». */
  currentValues: Record<string, unknown>
  appId?: number
  entityId?: string | 'new'
  /** Компактный режим для модалки создания. */
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
  !!result.value && Object.keys(result.value.suggestions).length > 0)

const totalSuggested = computed(() =>
  result.value ? Object.keys(result.value.suggestions).length : 0)

const selectedCount = computed(() =>
  Object.values(selectedFields.value).filter(Boolean).length)

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
  if (Object.keys(fields).length > 0) emit('apply', fields)
}

function applyAll() {
  const fields = pickAllAndReset()
  if (Object.keys(fields).length > 0) emit('apply', fields)
}

function applyHistoryItem(item: { suggestions: Record<string, unknown> | null }) {
  if (item.suggestions) emit('apply', item.suggestions)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    generate()
  }
  if (e.key === 'Escape') expanded.value = false
}

const showHistory = ref(false)

function toggleHistory() {
  showHistory.value = !showHistory.value
  if (showHistory.value && history.value.length === 0 && !historyLoading.value) {
    loadHistory()
  }
}

const textareaRows = computed(() => (props.compact ? 2 : 3))
</script>

<template>
  <div class="overflow-hidden rounded-md border border-accent-border">
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium"
      :class="expanded ? 'bg-accent-bg text-accent' : 'text-muted hover:bg-card'"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <Icon name="mingcute:sparkles-2-line" class="text-accent" />
      AI-автозаполнение полей
      <Icon
        name="mingcute:down-line"
        class="ml-auto text-subtle transition-transform duration-(--duration-fast)"
        :class="expanded && 'rotate-180'"
      />
    </button>

    <div v-if="expanded" class="flex flex-col gap-2" :class="compact ? 'px-2.5 pb-2.5' : 'px-3 pb-3'">
      <div class="flex items-end gap-1.5">
        <UiTextarea
          v-model="prompt"
          :rows="textareaRows"
          placeholder="Опишите персонажа: возраст, внешность, характер, роль"
          :disabled="loading"
          @keydown="onKeydown"
        />
        <UiTooltip text="Сгенерировать · Ctrl+Enter" placement="top">
          <UiButton
            variant="primary"
            icon-only
            size="md"
            :disabled="!prompt.trim()"
            :loading="loading"
            aria-label="Сгенерировать предложения"
            @click="generate"
          >
            <Icon v-if="!loading" name="mingcute:send-line" />
          </UiButton>
        </UiTooltip>
      </div>

      <div
        v-if="error"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg p-2 text-sm text-danger"
      >
        <Icon name="mingcute:close-circle-line" class="mt-0.5 shrink-0" />
        <div>
          <p class="font-medium">Ошибка AI</p>
          <p>{{ error }}</p>
        </div>
      </div>

      <div v-if="hasSuggestions" class="flex flex-col gap-2">
        <div class="flex items-center gap-1.5 text-sm text-muted">
          <Icon name="mingcute:eye-line" />
          Предпросмотр · выбрано {{ selectedCount }} из {{ totalSuggested }}
        </div>

        <p
          v-if="result?.reasoning"
          class="rounded-md border border-info-border bg-info-bg p-2 text-micro text-muted"
        >
          {{ result.reasoning }}
        </p>

        <div class="flex flex-col gap-0.5">
          <label
            v-for="(value, key) in result!.suggestions"
            :key="key"
            class="flex cursor-pointer items-start gap-2 rounded-sm p-1.5 hover:bg-card"
          >
            <input
              v-model="selectedFields[key as string]"
              type="checkbox"
              class="mt-0.5 size-3.5 cursor-pointer accent-(--color-accent)"
            >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                <span>{{ labelFor(key as string) }}</span>
                <span
                  v-if="hasChanged(key as string, value)"
                  class="rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-micro text-warning"
                >
                  меняется
                </span>
                <span v-else class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-subtle">
                  без изменений
                </span>
              </div>

              <div
                v-if="hasChanged(key as string, value)
                  && currentValues[key as string] !== undefined
                  && currentValues[key as string] !== null
                  && currentValues[key as string] !== ''"
                class="mt-0.5 text-micro break-words text-subtle line-through"
              >
                {{ formatValue(currentValues[key as string]) }}
              </div>

              <div class="text-micro break-words text-muted">
                <template v-if="Array.isArray(value)">
                  <span
                    v-for="(tag, i) in (value as string[])"
                    :key="i"
                    class="mr-0.5 mb-0.5 inline-block rounded-sm border border-accent-border bg-accent-bg px-1 py-0.5 text-accent"
                  >
                    {{ tag }}
                  </span>
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
          class="rounded-md border border-warning-border bg-warning-bg p-2 text-micro"
        >
          <div class="mb-1 flex items-center gap-1.5 font-medium text-warning">
            <Icon name="mingcute:shield-line" />
            AI сюда не пускают
          </div>
          <div v-for="b in result!.blocked" :key="b.field" class="text-muted">
            <span class="font-medium">{{ b.label }}:</span> {{ b.reason }}
          </div>
        </div>

        <div
          v-if="result!.rejected?.length"
          class="rounded-md border border-danger-border bg-danger-bg p-2 text-micro"
        >
          <div class="mb-1 flex items-center gap-1.5 font-medium text-danger">
            <Icon name="mingcute:alert-line" />
            Не прошло проверку
          </div>
          <div v-for="r in result!.rejected" :key="r.field" class="text-muted">
            <span class="font-medium">{{ r.field }}:</span> {{ r.reason }}
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <UiButton variant="primary" :disabled="selectedCount === 0" class="flex-1 justify-center" @click="applySelected">
            <Icon name="mingcute:check-line" />
            Применить выбранные · {{ selectedCount }}
          </UiButton>
          <UiButton @click="applyAll">Всё</UiButton>
          <UiButton icon-only variant="ghost" aria-label="Отклонить предложения" @click="dismiss">
            <Icon name="mingcute:close-line" />
          </UiButton>
        </div>
      </div>

      <p
        v-else-if="result && !hasSuggestions"
        class="rounded-md border border-warning-border bg-warning-bg p-2 text-sm text-muted"
      >
        AI не предложил безопасных значений.
        <span v-if="result.reasoning" class="mt-1 block text-micro">{{ result.reasoning }}</span>
      </p>

      <div class="border-t border-divider pt-1.5">
        <button
          type="button"
          class="flex cursor-pointer items-center gap-1 text-micro text-subtle hover:text-fg"
          :aria-expanded="showHistory"
          @click="toggleHistory"
        >
          <Icon
            name="mingcute:right-line"
            class="transition-transform duration-(--duration-fast)"
            :class="showHistory && 'rotate-90'"
          />
          Последние запросы
        </button>

        <div v-if="showHistory" class="mt-1">
          <div v-if="historyLoading" class="flex items-center gap-1.5 text-micro text-subtle">
            <Icon name="mingcute:loading-line" class="animate-spin" />
            Загружаем
          </div>
          <p v-else-if="!history.length" class="text-micro text-subtle italic">Пока пусто.</p>
          <ul v-else class="flex flex-col gap-0.5">
            <li
              v-for="item in history"
              :key="item.id"
              class="flex items-start gap-1.5 rounded-sm p-1 hover:bg-card"
            >
              <UiButton
                icon-only
                variant="ghost"
                :disabled="!item.suggestions"
                :title="item.suggestions ? 'Применить это предложение' : 'Применимых полей не было'"
                aria-label="Применить предложение из истории"
                @click="applyHistoryItem(item)"
              >
                <Icon name="mingcute:refresh-3-line" />
              </UiButton>
              <div class="min-w-0 flex-1">
                <div class="truncate text-micro text-muted">{{ item.prompt }}</div>
                <div class="tnum font-mono text-[10px] text-subtle">
                  {{ new Date(item.createdAt).toLocaleString('ru-RU') }} · {{ item.status }}
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
