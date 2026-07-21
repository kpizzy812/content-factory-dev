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

function onChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  emit('update:modelValue', val || null)
}
</script>

<template>
  <select
    class="select select-sm w-full"
    :value="modelValue ?? ''"
    :disabled="disabled || isLoading"
    @change="onChange"
  >
    <option value="" disabled>
      <template v-if="isLoading">Загрузка...</template>
      <template v-else-if="!items.length">Нет данных</template>
      <template v-else>{{ placeholder || 'Выберите' }}</template>
    </option>
    <option
      v-for="item in items"
      :key="item[valueField]"
      :value="item[valueField]"
    >
      {{ item[labelField] }}
    </option>
  </select>
</template>
