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
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Метрика</legend>
    <select
      class="select select-sm w-full"
      :value="config.filterMetric || 'views'"
      @change="emit('update', 'filterMetric', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="m in metricOptions" :key="m.value" :value="m.value">
        {{ m.label }}
      </option>
    </select>
    <SharedFieldHint text="По какому показателю фильтровать данные. Выберите одну метрику для проверки условия." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Оператор</legend>
    <select
      class="select select-sm w-full"
      :value="config.filterOperator || '>'"
      @change="emit('update', 'filterOperator', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="op in operatorOptions" :key="op.value" :value="op.value">
        {{ op.label }}
      </option>
    </select>
    <SharedFieldHint text="Как сравнивать метрику с пороговым значением." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Значение</legend>
    <input
      :value="config.filterValue || ''"
      type="number"
      class="input input-sm w-full"
      placeholder="10000"
      @input="emit('update', 'filterValue', Number(($event.target as HTMLInputElement).value))"
    />
    <SharedFieldHint text="Пороговое значение для сравнения. Например: 10000 для фильтра «просмотры > 10000»." example="10000" />
  </fieldset>
</template>
