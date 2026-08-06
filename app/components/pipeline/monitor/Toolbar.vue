<script setup lang="ts">
const store = usePipelineMonitorStore()

const RUNS_OPTIONS = [
  { value: '', label: 'Все конвейеры' },
  { value: 'yes', label: 'Есть запуски' },
  { value: 'no', label: 'Без запусков' },
]

const SORT_OPTIONS = [
  { value: 'active_first', label: 'Сначала активные' },
  { value: 'active_last', label: 'Сначала без запусков' },
]
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UiInput v-model="store.searchQuery" placeholder="Поиск по названию" class="max-w-64 flex-1" />

    <UiSelect v-model="store.runsFilter" :options="RUNS_OPTIONS" class="w-44" />
    <UiSelect v-model="store.sortMode" :options="SORT_OPTIONS" class="w-52" />

    <span class="flex-1" />

    <div class="flex rounded-md border border-border bg-card p-0.5">
      <button
        type="button"
        class="flex h-6 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-sm"
        :class="store.viewMode === 'list' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'"
        @click="store.viewMode = 'list'"
      >
        <Icon name="mingcute:list-check-line" />
        <span class="hidden sm:inline">Список</span>
      </button>
      <button
        type="button"
        class="flex h-6 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-sm"
        :class="store.viewMode === 'cards' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'"
        @click="store.viewMode = 'cards'"
      >
        <Icon name="mingcute:grid-line" />
        <span class="hidden sm:inline">Карточки</span>
      </button>
    </div>
  </div>
</template>
