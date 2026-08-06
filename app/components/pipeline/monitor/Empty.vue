<script setup lang="ts">
/** Пустое состояние монитора: различает «нет ничего» и «фильтры всё отсекли». */
const store = usePipelineMonitorStore()

const hasFilters = computed(() => !!store.searchQuery || !!store.runsFilter)
</script>

<template>
  <UiEmptyState
    :variant="hasFilters ? 'search' : undefined"
    :title="hasFilters ? 'Ничего не найдено' : 'Конвейеров нет'"
    :description="hasFilters
      ? 'Под текущий поиск и фильтры конвейеров нет.'
      : 'На этой странице конвейеров нет.'"
  >
    <UiButton v-if="hasFilters" @click="store.resetFilters()">Сбросить фильтры</UiButton>
  </UiEmptyState>
</template>
