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
      class="input input-sm w-full flex flex-wrap gap-1 items-start cursor-text min-h-8 h-auto max-h-24 overflow-y-auto py-1 content-start"
      @click="focusInput"
    >
      <span
        v-for="(tag, i) in modelValue"
        :key="tag"
        class="badge badge-neutral badge-sm gap-1 shrink-0"
      >
        {{ tag }}
        <button
          type="button"
          class="text-neutral-content/70 hover:text-neutral-content"
          @click.stop="removeTag(i)"
        >
          &times;
        </button>
      </span>
      <input
        ref="inputRef"
        v-model="inputText"
        type="text"
        class="flex-1 min-w-20 bg-transparent outline-none text-sm"
        :placeholder="modelValue.length ? '' : placeholder"
        @keydown="onKeydown"
        @input="onInput"
      />
    </div>
    <div class="flex items-center justify-between mt-0.5">
      <span v-if="modelValue.length > 0" class="text-[10px] text-base-content/40">
        {{ modelValue.length }} {{ modelValue.length === 1 ? 'тег' : 'тегов' }}
      </span>
      <button
        v-if="showAiButton"
        type="button"
        class="btn btn-ghost btn-xs ml-auto"
        @click.stop="emit('ai-suggest')"
      >
        <Icon name="mingcute:sparkles-2-line" class="text-sm" />
      </button>
    </div>
  </div>
</template>
