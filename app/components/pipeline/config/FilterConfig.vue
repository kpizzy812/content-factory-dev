<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const metricOptions = [
  { value: 'views', label: 'Просмотры' },
  { value: 'likes', label: 'Лайки' },
  { value: 'shares', label: 'Репосты' },
  { value: 'comments', label: 'Комментарии' },
  { value: 'watchThrough', label: 'Досматриваемость (%)' },
  { value: 'ctr', label: 'CTR (%)' },
]

const operatorOptions = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '=', label: '=' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
]
</script>

<template>
  <UiField label="Метрика">
    <UiSelect
      :model-value="config.filterMetric || 'views'"
      :options="metricOptions"
      @update:model-value="(v) => emit('update', 'filterMetric', v)"
    />
    <SharedFieldHint text="По какому показателю фильтровать данные. Выберите одну метрику для проверки условия." />
  </UiField>

  <UiField label="Оператор">
    <UiSelect
      :model-value="config.filterOperator || '>'"
      :options="operatorOptions"
      @update:model-value="(v) => emit('update', 'filterOperator', v)"
    />
    <SharedFieldHint text="Как сравнивать метрику с пороговым значением." />
  </UiField>

  <UiField label="Значение">
    <UiInput
      :model-value="config.filterValue || ''"
      type="number"
      placeholder="10000"
      @update:model-value="(v) => emit('update', 'filterValue', Number(v))"
    />
    <SharedFieldHint text="Пороговое значение для сравнения. Например: 10000 для фильтра «просмотры > 10000»." example="10000" />
  </UiField>
</template>
