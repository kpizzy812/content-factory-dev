<script setup lang="ts">
const filtersStore = useVideoFiltersStore()

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
        <option value="pending">Ожидание</option>
        <option value="generating_images">Генерация изображений</option>
        <option value="generating_clips">Генерация клипов</option>
        <option value="assembling">Сборка</option>
        <option value="completed">Готово</option>
        <option value="failed">Ошибка</option>
      </select>
    </fieldset>
  </div>
</template>
