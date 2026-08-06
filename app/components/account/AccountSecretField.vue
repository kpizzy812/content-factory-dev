<script setup lang="ts">
/**
 * Поле зашифрованного секрета: ввод, показ сохранённого значения и стирание.
 *
 * Пять полей доступов повторяли одну и ту же разметку из трёх элементов —
 * теперь она в одном месте, иначе кнопки глаза и крестика разъезжались.
 */
const props = defineProps<{
  modelValue: string
  label: string
  /** Значение уже сохранено — в поле показываем звёздочки вместо «не задано». */
  hasValue: boolean
  type?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  reveal: []
  clear: []
}>()

const placeholder = computed(() => (props.hasValue ? '•••••••• (не изменено)' : 'не задано'))
</script>

<template>
  <UiField :label="label">
    <div class="flex items-center gap-1">
      <UiInput
        :model-value="modelValue"
        :type="type ?? 'text'"
        :placeholder="placeholder"
        class="flex-1"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <UiButton
        icon-only
        variant="ghost"
        :disabled="!hasValue"
        :aria-label="`Показать: ${label}`"
        :title="hasValue ? 'Показать сохранённое значение' : 'Значение не задано'"
        @click="emit('reveal')"
      >
        <Icon name="mingcute:eye-line" />
      </UiButton>
      <UiButton
        icon-only
        variant="ghost"
        :aria-label="`Стереть: ${label}`"
        title="Стереть значение"
        @click="emit('clear')"
      >
        <Icon name="mingcute:close-line" />
      </UiButton>
    </div>
  </UiField>
</template>
