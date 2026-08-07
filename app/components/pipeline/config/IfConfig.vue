<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const operators = [
  { value: '>', label: 'Больше (>)' },
  { value: '<', label: 'Меньше (<)' },
  { value: '==', label: 'Равно (==)' },
  { value: '!=', label: 'Не равно (!=)' },
  { value: 'contains', label: 'Содержит' },
]
</script>

<template>
  <UiField label="Поле для проверки">
    <UiInput
      :model-value="config.field || ''"
      placeholder="status"
      @update:model-value="(v) => emit('update', 'field', v)"
    />
    <SharedFieldHint text="Имя поля из входных данных для проверки условия. Например: status, count, type." example="status" />
  </UiField>

  <UiField label="Оператор">
    <UiSelect
      :model-value="config.operator || '=='"
      :options="operators"
      @update:model-value="(v) => emit('update', 'operator', v)"
    />
    <SharedFieldHint text="Тип сравнения. «Содержит» — для текстового поиска внутри строки." />
  </UiField>

  <UiField label="Значение">
    <UiInput
      :model-value="config.value || ''"
      placeholder="expected_value"
      @update:model-value="(v) => emit('update', 'value', v)"
    />
    <SharedFieldHint text="С чем сравнивать. Для чисел — числовое значение. Для строк — текст." example="success" />
  </UiField>

  <p class="rounded-md border border-border bg-card px-2.5 py-2 text-micro text-muted">
    Результат определяет путь: <code class="font-mono text-success">main</code> (true) или
    <code class="font-mono text-danger">error</code> (false).
  </p>
</template>
