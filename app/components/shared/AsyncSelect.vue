<script setup lang="ts">
const props = defineProps<{
  url: string
  labelField: string
  valueField: string
  modelValue: string | number | null
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
}>()

const { data, status } = useFetch<{ data: Record<string, any>[] }>(props.url, {
  default: () => ({ data: [] }),
})

const items = computed(() => data.value?.data ?? [])
const isLoading = computed(() => status.value === 'pending')

const options = computed(() => items.value.map(item => ({
  value: item[props.valueField],
  label: String(item[props.labelField]),
})))

const emptyLabel = computed(() => {
  if (isLoading.value) return 'Загрузка…'
  if (!items.value.length) return 'Нет данных'
  return props.placeholder || 'Выберите'
})
</script>

<template>
  <UiSelect
    :model-value="modelValue ?? ''"
    :options="options"
    :placeholder="emptyLabel"
    :disabled="disabled || isLoading"
    @update:model-value="(v) => emit('update:modelValue', v || null)"
  />
</template>
