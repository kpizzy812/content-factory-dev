<script setup lang="ts">
const props = defineProps<{
  modelValue: string[]
  placeholder?: string
  showAiButton?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [tags: string[]]
  'ai-suggest': []
}>()

const inputText = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function commitTag(raw: string) {
  const tag = raw.trim()
  if (!tag) return
  if (props.modelValue.includes(tag)) return
  emit('update:modelValue', [...props.modelValue, tag])
}

function removeTag(index: number) {
  const updated = [...props.modelValue]
  updated.splice(index, 1)
  emit('update:modelValue', updated)
}

// Запятая — разделитель. Режем текст: всё до последней запятой → в теги,
// хвост оставляем в инпуте. Пользователь может писать "kw1, kw2, kw3" натурально
// с пробелами после запятых — пробелы trim'атся при commit, хвост видим как обычно.
function onInput() {
  if (!inputText.value.includes(',')) return
  const parts = inputText.value.split(',')
  const tail = parts.pop() ?? ''
  const existing = new Set(props.modelValue)
  const additions: string[] = []
  for (const p of parts) {
    const t = p.trim()
    if (t && !existing.has(t) && !additions.includes(t)) additions.push(t)
  }
  if (additions.length > 0) {
    emit('update:modelValue', [...props.modelValue, ...additions])
  }
  inputText.value = tail
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitTag(inputText.value)
    inputText.value = ''
  }
  if (e.key === 'Backspace' && !inputText.value && props.modelValue.length) {
    removeTag(props.modelValue.length - 1)
  }
}

function focusInput() {
  inputRef.value?.focus()
}
</script>

<template>
  <div class="w-full">
    <div
      class="flex max-h-24 min-h-8 w-full cursor-text flex-wrap content-start items-start gap-1 overflow-y-auto rounded-md border border-border bg-card px-2 py-1 focus-within:border-accent"
      @click="focusInput"
    >
      <span
        v-for="(tag, i) in modelValue"
        :key="tag"
        class="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm border border-border bg-panel pr-1 pl-2 text-sm text-muted"
      >
        {{ tag }}
        <button
          type="button"
          class="cursor-pointer text-subtle hover:text-danger"
          :aria-label="`Убрать тег ${tag}`"
          @click.stop="removeTag(i)"
        >
          <Icon name="mingcute:close-line" />
        </button>
      </span>
      <input
        ref="inputRef"
        v-model="inputText"
        type="text"
        class="min-w-20 flex-1 bg-transparent text-base outline-none"
        :placeholder="modelValue.length ? '' : placeholder"
        @keydown="onKeydown"
        @input="onInput"
      >
    </div>

    <div class="mt-0.5 flex items-center gap-2">
      <span v-if="modelValue.length" class="tnum font-mono text-micro text-subtle">
        {{ modelValue.length }} тегов
      </span>
      <UiButton
        v-if="showAiButton"
        icon-only
        variant="ghost"
        class="ml-auto"
        aria-label="Предложить теги моделью"
        @click.stop="emit('ai-suggest')"
      >
        <Icon name="mingcute:magic-1-line" />
      </UiButton>
    </div>
  </div>
</template>
