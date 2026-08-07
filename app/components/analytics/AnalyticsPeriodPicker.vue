<script setup lang="ts">
/**
 * Окно сквозной аналитики: сутки, неделя, месяц или произвольный период.
 *
 * Пресет и произвольные даты — разные состояния, а не одно: при пресете сервер
 * считает окно сам, и две пустые даты в запросе не спорят с ним за смысл.
 */
import type { AnalyticsPeriodPreset } from '#shared/types/analytics-funnel'

const store = useAnalyticsFiltersStore()

const PRESETS: Array<{ value: AnalyticsPeriodPreset; label: string }> = [
  { value: '24h', label: '24 ч' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
]

const customOpen = computed(() => store.period === 'custom')

function choose(preset: AnalyticsPeriodPreset) {
  store.period = preset
  if (preset !== 'custom') {
    store.dateFrom = ''
    store.dateTo = ''
  }
  store.resetPage()
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex rounded-md border border-border bg-card p-0.5">
      <button
        v-for="preset in PRESETS"
        :key="preset.value"
        type="button"
        class="h-6 rounded-sm px-2.5 text-micro"
        :class="store.period === preset.value ? 'bg-raised text-fg' : 'text-subtle hover:text-fg'"
        @click="choose(preset.value)"
      >
        {{ preset.label }}
      </button>
      <button
        type="button"
        class="h-6 rounded-sm px-2.5 text-micro"
        :class="customOpen ? 'bg-raised text-fg' : 'text-subtle hover:text-fg'"
        @click="choose('custom')"
      >
        Период…
      </button>
    </div>

    <template v-if="customOpen">
      <UiInput
        v-model="store.dateFrom"
        type="date"
        class="max-w-[150px]"
        aria-label="Дата от"
        @change="store.resetPage()"
      />
      <span class="text-subtle">—</span>
      <UiInput
        v-model="store.dateTo"
        type="date"
        class="max-w-[150px]"
        aria-label="Дата до"
        @change="store.resetPage()"
      />
    </template>
  </div>
</template>
