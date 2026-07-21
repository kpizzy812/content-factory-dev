<script setup lang="ts">
import {
  ADMIN_LOG_SOURCE_ICONS,
  ADMIN_LOG_SOURCE_LABELS,
  ADMIN_LOG_SOURCES_ALL,
  type AdminLogSource,
} from '~~/shared/types/admin-log'

const store = useAdminFiltersStore()

const levelOptions = [
  { value: '', label: 'Все уровни' },
  { value: 'info', label: 'Инфо' },
  { value: 'warn', label: 'Внимание' },
  { value: 'error', label: 'Ошибка' },
]

const resolvedOptions = [
  { value: '', label: 'Все статусы' },
  { value: 'true', label: 'Решённые' },
  { value: 'false', label: 'Нерешённые' },
]

const sources = ADMIN_LOG_SOURCES_ALL

const allSelected = computed(() => store.logSources.length === sources.length)
const noneSelected = computed(() => store.logSources.length === 0)

function isActive(s: AdminLogSource): boolean {
  return store.logSources.includes(s)
}

function onChange() {
  store.resetPage()
}
</script>

<template>
  <div class="card card-border bg-base-100">
    <div class="card-body p-4 gap-3">
      <!-- Источники -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
            Источники
          </span>
          <div class="flex gap-1">
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              :disabled="allSelected"
              @click="store.selectAllLogSources()"
            >
              Выбрать все
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              :disabled="noneSelected"
              @click="store.clearLogSources()"
            >
              Очистить
            </button>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="src in sources"
            :key="src"
            type="button"
            class="badge badge-lg gap-1 cursor-pointer hover:badge-primary transition-colors"
            :class="isActive(src) ? 'badge-primary' : 'badge-soft'"
            @click="store.toggleLogSource(src)"
          >
            <Icon :name="ADMIN_LOG_SOURCE_ICONS[src]" class="text-sm" />
            {{ ADMIN_LOG_SOURCE_LABELS[src] }}
          </button>
        </div>
      </div>

      <!-- Уровень + статус + поиск -->
      <div class="flex flex-wrap gap-2 items-center pt-2 border-t border-base-200">
        <select v-model="store.logLevel" class="select select-sm" @change="onChange">
          <option v-for="opt in levelOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <select v-model="store.logResolved" class="select select-sm" @change="onChange">
          <option v-for="opt in resolvedOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <label class="input input-sm flex-1 min-w-[180px]">
          <Icon name="mingcute:search-line" class="text-base-content/50" />
          <input
            v-model="store.logQ"
            type="text"
            placeholder="Поиск по сообщению…"
            @input="onChange"
          >
        </label>
      </div>
    </div>
  </div>
</template>
