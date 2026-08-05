<script setup lang="ts">
/** Текстовое поле. Источник: design-preview/_system/blocks/Field.html */
const props = withDefaults(defineProps<{
  modelValue?: string | number | null
  type?: string
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  readonly?: boolean
  /** Моноширинный шрифт — для ID, токенов и чисел. */
  mono?: boolean
}>(), { type: 'text' })

defineEmits<{ 'update:modelValue': [value: string] }>()

const tone = computed(() => {
  if (props.disabled) return 'bg-surface border border-dashed border-divider text-subtle cursor-not-allowed'
  if (props.readonly) return 'bg-surface border border-divider text-muted'
  if (props.invalid) return 'bg-card border border-danger text-fg'
  return 'bg-card border border-border text-fg focus:border-accent'
})
</script>

<template>
  <input
    :type="type"
    :value="modelValue ?? ''"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    class="h-8 w-full rounded-md px-2.5 text-base outline-offset-1"
    :class="[tone, mono && 'font-mono']"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  >
</template>
