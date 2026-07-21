<script setup lang="ts">
const filtersStore = useIdeaFiltersStore()

function onFilterChange() {
  filtersStore.resetPage()
}

const hasActiveFilters = computed(() =>
  filtersStore.status || filtersStore.source || filtersStore.analysisStatus || filtersStore.syncStatus,
)
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
        <option value="processing">Обработка</option>
        <option value="ready">Готово</option>
        <option value="in_work">В работе</option>
        <option value="completed">Завершено</option>
        <option value="failed">Ошибка</option>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Источник</legend>
      <select
        v-model="filtersStore.source"
        class="select"
        @change="onFilterChange"
      >
        <option value="">Все источники</option>
        <option value="manual">Ручной ввод</option>
        <option value="telegram">Telegram</option>
        <option value="marketingcamp">MarketingCamp</option>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Анализ</legend>
      <select
        v-model="filtersStore.analysisStatus"
        class="select"
        @change="onFilterChange"
      >
        <option value="">Все</option>
        <option value="completed">Анализ готов</option>
        <option value="running">Анализируется</option>
        <option value="failed">Анализ ошибка</option>
        <option value="none">Нет анализа</option>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Синхронизация</legend>
      <select
        v-model="filtersStore.syncStatus"
        class="select"
        @change="onFilterChange"
      >
        <option value="">Все</option>
        <option value="none">Локальные</option>
        <option value="synced">Синхронизированы</option>
        <option value="conflict">Конфликт</option>
        <option value="error">Ошибка синхр.</option>
        <option value="pending_export">Ожидают экспорт</option>
      </select>
    </fieldset>

    <button
      v-if="hasActiveFilters"
      class="btn btn-sm btn-ghost gap-1"
      @click="filtersStore.resetFilters()"
    >
      <Icon name="mingcute:close-line" class="text-xs" />
      Сбросить
    </button>
  </div>
</template>
