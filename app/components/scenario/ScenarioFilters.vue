<script setup lang="ts">
const filtersStore = useScenarioFiltersStore()

function onFilterChange() {
  filtersStore.resetPage()
}
</script>

<template>
  <div class="flex flex-col sm:flex-row gap-3 items-end flex-wrap">
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Статус</legend>
      <select
        v-model="filtersStore.status"
        class="select"
        @change="onFilterChange"
      >
        <option value="">Все статусы</option>
        <option value="generated">Сгенерирован</option>
        <option value="selected">Выбран</option>
        <option value="rejected">Отклонён</option>
        <option value="needs_rework">На доработку</option>
        <option value="generating">Генерация...</option>
        <option value="archived">Архив</option>
      </select>
    </fieldset>
  </div>
</template>
