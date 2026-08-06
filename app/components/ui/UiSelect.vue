<script setup lang="ts">
/** Выпадающий список. Источник: design-preview/_system/blocks/Field.html */
const props = withDefaults(defineProps<{
  modelValue?: string | number | null
  options: Array<{ value: string | number, label: string }>
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
}>(), {})

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

/**
 * Значение идёт через v-model, а не через :value на `<select>`.
 *
 * С `:value` браузер получает значение раньше, чем появляются `<option>`, и
 * откатывается на первый пункт — селект с числовыми значениями всегда показывал
 * первый вариант. Директива v-model выставляет выбранный пункт после монтирования
 * и одинаково ведёт себя на сервере и в браузере, поэтому гидратация не ломается.
 */
const inner = computed({
  get: () => props.modelValue ?? '',
  set: value => emit('update:modelValue', value),
})

const tone = computed(() => {
  if (props.disabled) return 'bg-surface border border-dashed border-divider text-subtle cursor-not-allowed'
  if (props.invalid) return 'bg-card border border-danger text-fg'
  return 'bg-card border border-border text-fg focus:border-accent cursor-pointer'
})
</script>

<template>
  <div class="relative">
    <select
      v-model="inner"
      :disabled="disabled"
      class="h-8 w-full appearance-none rounded-md pr-[30px] pl-2.5 text-base outline-offset-1"
      :class="tone"
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
