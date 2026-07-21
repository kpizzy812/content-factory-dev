<script setup lang="ts">
const store = usePipelineMonitorStore()
</script>

<template>
  <div class="flex flex-col md:flex-row items-stretch md:items-center gap-2 md:gap-3 flex-wrap">
    <label class="input input-sm flex-1 min-w-0">
      <Icon name="mingcute:search-line" class="text-base-content/50" />
      <input
        v-model="store.searchQuery"
        type="text"
        class="grow"
        placeholder="Поиск по названию..."
      >
    </label>

    <select v-model="store.runsFilter" class="select select-sm min-w-40">
      <option value="">
        Все конвейеры
      </option>
      <option value="yes">
        Есть раны
      </option>
      <option value="no">
        Нет ранов
      </option>
    </select>

    <select v-model="store.sortMode" class="select select-sm min-w-52">
      <option value="active_first">
        Сначала активные
      </option>
      <option value="active_last">
        Сначала без ранов
      </option>
    </select>

    <div class="join">
      <button
        class="join-item btn btn-sm"
        :class="store.viewMode === 'list' ? 'btn-active btn-primary' : ''"
        title="Список"
        @click="store.viewMode = 'list'"
      >
        <Icon name="mingcute:list-check-line" />
        <span class="hidden sm:inline">Список</span>
      </button>
      <button
        class="join-item btn btn-sm"
        :class="store.viewMode === 'cards' ? 'btn-active btn-primary' : ''"
        title="Карточки"
        @click="store.viewMode = 'cards'"
      >
        <Icon name="mingcute:grid-line" />
        <span class="hidden sm:inline">Карточки</span>
      </button>
    </div>
  </div>
</template>
