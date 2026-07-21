<script setup lang="ts">
const props = defineProps<{
  loading?: boolean
  /** Включает inline-промт поле. Без этого — обычный click emit. */
  withPrompt?: boolean
  /** Placeholder для поля промта */
  placeholder?: string
  /** Включить preview перед применением */
  withPreview?: boolean
  /** Текущий preview результат (items или text + reasoning) */
  previewData?: { items?: string[]; text?: string; reasoning?: string } | null
}>()

const emit = defineEmits<{
  click: []
  suggest: [prompt: string]
  /** Пользователь подтвердил применение preview */
  apply: []
  /** Пользователь отклонил preview */
  dismiss: []
}>()

const expanded = ref(false)
const prompt = ref('')
const inputRef = ref<HTMLInputElement>()

function handleClick() {
  if (props.withPrompt) {
    expanded.value = !expanded.value
    if (expanded.value) {
      nextTick(() => inputRef.value?.focus())
    }
  } else {
    emit('click')
  }
}

function submit() {
  const text = prompt.value.trim()
  if (!text) return
  emit('suggest', text)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
  if (e.key === 'Escape') {
    expanded.value = false
    prompt.value = ''
  }
}

// Закрываем после успешного suggest (loading стал false) — но только если нет preview
watch(() => props.loading, (isLoading, wasLoading) => {
  if (wasLoading && !isLoading && props.withPrompt && !props.withPreview) {
    expanded.value = false
    prompt.value = ''
  }
})

function applyPreview() {
  emit('apply')
  expanded.value = false
  prompt.value = ''
}

function dismissPreview() {
  emit('dismiss')
}

const showPreview = computed(() =>
  props.withPreview && props.previewData && !props.loading,
)
</script>

<template>
  <span class="inline-flex flex-col">
    <span class="inline-flex items-center">
      <button
        type="button"
        class="btn btn-ghost btn-xs gap-1"
        :disabled="loading"
        @click="handleClick"
      >
        <span v-if="loading" class="loading loading-spinner loading-xs" />
        <Icon v-else name="mingcute:sparkles-2-line" class="text-sm" />
        <span class="text-xs">AI</span>
      </button>

      <!-- Inline prompt -->
      <Transition name="fade">
        <span v-if="expanded && withPrompt" class="inline-flex items-center gap-1 ml-1">
          <input
            ref="inputRef"
            v-model="prompt"
            type="text"
            class="input input-xs w-44 font-normal"
            :placeholder="placeholder || 'Опишите, что сгенерировать...'"
            :disabled="loading"
            @keydown="onKeydown"
          />
          <button
            type="button"
            class="btn btn-primary btn-xs btn-square"
            :disabled="!prompt.trim() || loading"
            @click="submit"
          >
            <span v-if="loading" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:send-line" class="text-xs" />
          </button>
        </span>
      </Transition>
    </span>

    <!-- Preview before apply -->
    <Transition name="preview">
      <div
        v-if="showPreview"
        class="mt-1.5 rounded-box border border-primary/20 bg-primary/5 p-2 text-[10px] space-y-1.5"
      >
        <div class="flex items-center gap-1 text-primary font-medium">
          <Icon name="mingcute:eye-line" class="text-xs" />
          AI предлагает:
        </div>

        <!-- Tags preview -->
        <div v-if="previewData?.items?.length" class="flex flex-wrap gap-0.5">
          <span
            v-for="(item, i) in previewData.items"
            :key="i"
            class="inline-block bg-primary/10 text-primary rounded px-1.5 py-0.5"
          >
            {{ item }}
          </span>
        </div>

        <!-- Text preview -->
        <div v-if="previewData?.text" class="text-base-content/70">
          <template v-if="previewData.text.length > 120">
            <details class="group">
              <summary class="cursor-pointer text-primary/70">
                {{ previewData.text.slice(0, 120) }}...
              </summary>
              <p class="mt-1 whitespace-pre-wrap">{{ previewData.text }}</p>
            </details>
          </template>
          <template v-else>
            {{ previewData.text }}
          </template>
        </div>

        <!-- Reasoning -->
        <div v-if="previewData?.reasoning" class="text-base-content/40 italic">
          {{ previewData.reasoning }}
        </div>

        <!-- Actions -->
        <div class="flex gap-1">
          <button class="btn btn-primary btn-xs flex-1" @click="applyPreview">
            <Icon name="mingcute:check-line" class="text-[10px]" />
            Применить
          </button>
          <button class="btn btn-ghost btn-xs" @click="dismissPreview">
            Отмена
          </button>
        </div>
      </div>
    </Transition>
  </span>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-4px);
}

.preview-enter-active,
.preview-leave-active {
  transition: opacity 0.15s ease, max-height 0.2s ease;
  overflow: hidden;
}
.preview-enter-from,
.preview-leave-to {
  opacity: 0;
  max-height: 0;
}
.preview-enter-to,
.preview-leave-from {
  max-height: 300px;
}
</style>
