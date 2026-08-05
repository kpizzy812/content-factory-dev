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
      <UiButton variant="ghost" :loading="loading" @click="handleClick">
        <Icon v-if="!loading" name="mingcute:magic-1-line" />
        Модель
      </UiButton>

      <!-- Inline prompt -->
      <Transition name="fade">
        <span v-if="expanded && withPrompt" class="ml-1 inline-flex items-center gap-1">
          <UiInput
            ref="inputRef"
            v-model="prompt"
            class="w-44"
            :placeholder="placeholder || 'Что сгенерировать?'"
            :disabled="loading"
            @keydown="onKeydown"
          />
          <UiButton
            variant="primary"
            icon-only
            :loading="loading"
            :disabled="!prompt.trim()"
            aria-label="Отправить"
            @click="submit"
          >
            <Icon v-if="!loading" name="mingcute:send-line" />
          </UiButton>
        </span>
      </Transition>
    </span>

    <!-- Preview before apply -->
    <Transition name="preview">
      <div
        v-if="showPreview"
        class="mt-1.5 flex flex-col gap-1.5 rounded-md border border-accent-border bg-accent-bg p-2 text-sm"
      >
        <div class="text-micro tracking-[.06em] text-subtle uppercase">Предложение модели</div>

        <!-- Теги -->
        <div v-if="previewData?.items?.length" class="flex flex-wrap gap-1">
          <span
            v-for="(item, i) in previewData.items"
            :key="i"
            class="rounded-sm border border-border bg-card px-1.5 text-micro text-muted"
          >
            {{ item }}
          </span>
        </div>

        <!-- Текст -->
        <div v-if="previewData?.text" class="text-muted">
          <details v-if="previewData.text.length > 120">
            <summary class="cursor-pointer">{{ previewData.text.slice(0, 120) }}…</summary>
            <p class="mt-1 whitespace-pre-wrap">{{ previewData.text }}</p>
          </details>
          <template v-else>{{ previewData.text }}</template>
        </div>

        <p v-if="previewData?.reasoning" class="text-micro text-subtle">
          {{ previewData.reasoning }}
        </p>

        <div class="flex gap-1.5">
          <UiButton variant="primary" @click="applyPreview">Применить</UiButton>
          <UiButton variant="ghost" @click="dismissPreview">Отмена</UiButton>
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
