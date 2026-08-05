<script setup lang="ts">
/** Переключатель 34×20. Источник: design-preview/_system/blocks/Field.html */
const props = defineProps<{
  modelValue?: boolean
  label?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle() {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    class="flex items-center gap-2.5 text-base"
    :class="[
      disabled ? 'cursor-not-allowed text-subtle' : 'cursor-pointer',
      modelValue ? 'text-fg' : 'text-muted',
    ]"
    @click="toggle"
  >
    <span
      class="relative h-5 w-[34px] shrink-0 rounded-full transition-colors duration-(--duration-fast) ease-out"
      :class="modelValue ? 'bg-accent' : 'border border-border bg-neutral-bg'"
    >
      <span
        class="absolute top-0.5 size-4 rounded-full transition-all duration-(--duration-fast) ease-out"
        :class="modelValue ? 'left-4 bg-on-accent' : 'left-0.5 bg-subtle'"
      />
    </span>
    <span v-if="label">{{ label }}</span>
  </button>
</template>
