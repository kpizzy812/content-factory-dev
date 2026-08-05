<script setup lang="ts">
/** Чекбокс с подписью. Источник: design-preview/_system/blocks/Field.html */
defineProps<{
  modelValue?: boolean
  label?: string
  disabled?: boolean
  /** Частичный выбор — «выделены не все строки страницы». */
  indeterminate?: boolean
}>()

defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <label
    class="flex items-center gap-[9px] text-base"
    :class="disabled ? 'cursor-not-allowed text-subtle' : 'cursor-pointer'"
  >
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :indeterminate="indeterminate"
      class="size-4 rounded-sm accent-(--color-accent)"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    >
    <span v-if="label">{{ label }}</span>
    <slot />
  </label>
</template>
