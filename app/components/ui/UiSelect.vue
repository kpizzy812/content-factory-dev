<script setup lang="ts">
/** Выпадающий список. Источник: design-preview/_system/blocks/Field.html */
const props = withDefaults(defineProps<{
  modelValue?: string | number | null
  options: Array<{ value: string | number, label: string }>
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
}>(), {})

defineEmits<{ 'update:modelValue': [value: string] }>()

const tone = computed(() => {
  if (props.disabled) return 'bg-surface border border-dashed border-divider text-subtle cursor-not-allowed'
  if (props.invalid) return 'bg-card border border-danger text-fg'
  return 'bg-card border border-border text-fg focus:border-accent cursor-pointer'
})
</script>

<template>
  <div class="relative">
    <select
      :value="modelValue ?? ''"
      :disabled="disabled"
      class="h-8 w-full appearance-none rounded-md pr-[30px] pl-2.5 text-base outline-offset-1"
      :class="tone"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <Icon
      name="mingcute:down-line"
      class="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-subtle"
    />
  </div>
</template>
