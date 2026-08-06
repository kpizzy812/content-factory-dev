<script setup lang="ts">
/**
 * Фильтры ленты журналов.
 *
 * Источники переключаются по одному: чаще всего смотрят один-два, а не «всё
 * кроме». Кнопки «все» и «очистить» рядом, чтобы вернуться в исходное было
 * одним кликом.
 */
import {
  ADMIN_LOG_SOURCE_ICONS,
  ADMIN_LOG_SOURCE_LABELS,
  ADMIN_LOG_SOURCES_ALL,
  type AdminLogSource,
} from '~~/shared/types/admin-log'

const store = useAdminFiltersStore()

const levelOptions = [
  { value: '', label: 'Любой уровень' },
  { value: 'info', label: 'Инфо' },
  { value: 'warn', label: 'Важно' },
  { value: 'error', label: 'Ошибки' },
]

const resolvedOptions = [
  { value: '', label: 'Разобранные и нет' },
  { value: 'true', label: 'Разобранные' },
  { value: 'false', label: 'Неразобранные' },
]

const sources = ADMIN_LOG_SOURCES_ALL

const allSelected = computed(() => store.logSources.length === sources.length)
const noneSelected = computed(() => store.logSources.length === 0)

function isActive(s: AdminLogSource): boolean {
  return store.logSources.includes(s)
}
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Источники</h2>
      <span class="flex-1" />
      <UiButton variant="ghost" :disabled="allSelected" @click="store.selectAllLogSources()">
        Все
      </UiButton>
      <UiButton variant="ghost" :disabled="noneSelected" @click="store.clearLogSources()">
        Очистить
      </UiButton>
    </div>

    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="src in sources"
        :key="src"
        type="button"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-0.5 text-sm transition-colors duration-(--duration-fast)"
        :class="isActive(src)
          ? 'border-accent-border bg-accent-bg text-accent'
          : 'border-divider text-muted hover:text-fg'"
        :aria-pressed="isActive(src)"
        @click="store.toggleLogSource(src)"
      >
        <Icon :name="ADMIN_LOG_SOURCE_ICONS[src]" />
        {{ ADMIN_LOG_SOURCE_LABELS[src] }}
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t border-divider pt-2.5">
      <UiSelect
        v-model="store.logLevel"
        class="w-44"
        :options="levelOptions"
        @update:model-value="store.resetPage()"
      />
      <UiSelect
        v-model="store.logResolved"
        class="w-52"
        :options="resolvedOptions"
        @update:model-value="store.resetPage()"
      />
      <UiInput
        v-model="store.logQ"
        class="max-w-72 min-w-44 flex-1"
        placeholder="Поиск по сообщению"
        @update:model-value="store.resetPage()"
      />
      <UiButton variant="ghost" @click="store.resetLogFilters()">Сбросить</UiButton>
    </div>
  </section>
</template>
