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
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Поле для проверки</legend>
    <input
      :value="config.field || ''"
      class="input input-sm w-full"
      placeholder="status"
      @input="emit('update', 'field', ($event.target as HTMLInputElement).value)"
    />
    <SharedFieldHint text="Имя поля из входных данных для проверки условия. Например: status, count, type." example="status" />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Оператор</legend>
    <select
      class="select select-sm w-full"
      :value="config.operator || '=='"
      @change="emit('update', 'operator', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="op in operators" :key="op.value" :value="op.value">
        {{ op.label }}
      </option>
    </select>
    <SharedFieldHint text="Тип сравнения. «Содержит» — для текстового поиска внутри строки." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Значение</legend>
    <input
      :value="config.value || ''"
      class="input input-sm w-full"
      placeholder="expected_value"
      @input="emit('update', 'value', ($event.target as HTMLInputElement).value)"
    />
    <SharedFieldHint text="С чем сравнивать. Для чисел — числовое значение. Для строк — текст." example="success" />
  </fieldset>

  <div class="p-2 rounded-box bg-base-200 text-[10px] text-base-content/60">
    <p>Результат определяет путь: <code class="text-success">main</code> (true) или <code class="text-error">error</code> (false).</p>
  </div>
</template>
