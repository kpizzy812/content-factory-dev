<script setup lang="ts">
const filtersStore = useTrendFiltersStore()
const showAdvanced = ref(false)

function onFilterChange() {
  filtersStore.resetPage()
}

const hasActiveAdvancedFilters = computed(() => {
  return !!(
    filtersStore.hashtags
    || filtersStore.geo
    || filtersStore.language
    || filtersStore.viewCountMin
    || filtersStore.viewCountMax
    || filtersStore.analysisStatus
  )
})
</script>

<template>
  <div class="space-y-3">
    <!-- Основные фильтры -->
    <div class="flex flex-col sm:flex-row gap-3 items-end flex-wrap">
      <!-- Поиск -->
      <fieldset class="fieldset flex-1 min-w-48">
        <legend class="fieldset-legend">Поиск</legend>
        <label class="input w-full">
          <Icon name="mingcute:search-line" class="text-base-content/40" />
          <input
            v-model="filtersStore.search"
            type="text"
            placeholder="По заголовку..."
            @input="onFilterChange"
          >
        </label>
      </fieldset>

      <!-- Статус -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Статус</legend>
        <select
          v-model="filtersStore.status"
          class="select"
          @change="onFilterChange"
        >
          <option value="">Все статусы</option>
          <option value="new">Новый</option>
          <option value="reviewed">Просмотрен</option>
          <option value="in_work">В работе</option>
          <option value="completed">Завершён</option>
          <option value="dismissed">Отклонён</option>
        </select>
      </fieldset>

      <!-- Платформа -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Платформа</legend>
        <select
          v-model="filtersStore.platform"
          class="select"
          @change="onFilterChange"
        >
          <option value="">Все платформы</option>
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
          <option value="youtube">YouTube</option>
        </select>
      </fieldset>

      <!-- Источник -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Источник</legend>
        <select
          v-model="filtersStore.source"
          class="select"
          @change="onFilterChange"
        >
          <option value="">Все</option>
          <option value="mc">MarketingCamp</option>
          <option value="local">Завод</option>
        </select>
      </fieldset>

      <!-- Сортировка -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Сортировка</legend>
        <select
          v-model="filtersStore.sort"
          class="select"
          @change="onFilterChange"
        >
          <option value="importedAt">По дате</option>
          <option value="viewCount">По просмотрам</option>
        </select>
      </fieldset>

      <!-- Кнопка доп. фильтров -->
      <button
        class="btn btn-sm btn-ghost gap-1"
        :class="{ 'btn-active': showAdvanced || hasActiveAdvancedFilters }"
        @click="showAdvanced = !showAdvanced"
      >
        <Icon name="mingcute:filter-line" />
        Ещё
        <span v-if="hasActiveAdvancedFilters" class="badge badge-xs badge-primary" />
      </button>
    </div>

    <!-- Расширенные фильтры -->
    <div v-if="showAdvanced" class="flex flex-col sm:flex-row gap-3 items-end flex-wrap p-3 bg-base-200 rounded-lg">
      <!-- Хештеги -->
      <fieldset class="fieldset flex-1 min-w-48">
        <legend class="fieldset-legend">
          Хештеги
          <span class="text-xs text-base-content/40 ml-1">(через запятую)</span>
        </legend>
        <input
          v-model="filtersStore.hashtags"
          type="text"
          class="input w-full"
          placeholder="dance, funny, viral"
          @input="onFilterChange"
        >
      </fieldset>

      <!-- Гео -->
      <fieldset class="fieldset min-w-32">
        <legend class="fieldset-legend">
          Гео
          <span class="text-xs text-base-content/40 ml-1">(из профиля парсинга)</span>
        </legend>
        <input
          v-model="filtersStore.geo"
          type="text"
          class="input w-full"
          placeholder="RU, US, DE..."
          @input="onFilterChange"
        >
      </fieldset>

      <!-- Язык -->
      <fieldset class="fieldset min-w-32">
        <legend class="fieldset-legend">
          Язык
          <span class="text-xs text-base-content/40 ml-1">(из профиля парсинга)</span>
        </legend>
        <input
          v-model="filtersStore.language"
          type="text"
          class="input w-full"
          placeholder="ru, en, de..."
          @input="onFilterChange"
        >
      </fieldset>

      <!-- Просмотры -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Просмотры (от)</legend>
        <input
          v-model="filtersStore.viewCountMin"
          type="number"
          class="input w-28"
          placeholder="0"
          min="0"
          @input="onFilterChange"
        >
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Просмотры (до)</legend>
        <input
          v-model="filtersStore.viewCountMax"
          type="number"
          class="input w-28"
          placeholder="999999"
          min="0"
          @input="onFilterChange"
        >
      </fieldset>

      <!-- Статус анализа -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend">AI-анализ</legend>
        <select
          v-model="filtersStore.analysisStatus"
          class="select"
          @change="onFilterChange"
        >
          <option value="">Все</option>
          <option value="none">Не анализирован</option>
          <option value="completed">Анализирован</option>
          <option value="running">В процессе</option>
          <option value="failed">Ошибка</option>
        </select>
      </fieldset>

      <!-- Сброс расширенных -->
      <button
        v-if="hasActiveAdvancedFilters"
        class="btn btn-sm btn-ghost text-error"
        @click="filtersStore.reset(); showAdvanced = false"
      >
        Сбросить всё
      </button>
    </div>
  </div>
</template>
