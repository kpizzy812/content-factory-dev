<script setup lang="ts">
/** Многострочное поле. Источник: design-preview/_system/blocks/Field.html */
const props = withDefaults(defineProps<{
  modelValue?: string | null
  rows?: number
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
}>(), { rows: 3 })

defineEmits<{ 'update:modelValue': [value: string] }>()

const tone = computed(() => {
  if (props.disabled) return 'bg-surface border border-dashed border-divider text-subtle cursor-not-allowed'
  if (props.invalid) return 'bg-card border border-danger text-fg'
  return 'bg-card border border-border text-fg focus:border-accent'
})
</script>

<template>
  <textarea
    :value="modelValue ?? ''"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    class="w-full resize-y rounded-md px-2.5 py-2 text-base outline-offset-1"
    :class="tone"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
