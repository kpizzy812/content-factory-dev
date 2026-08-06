<script setup lang="ts">
import type { DashboardCounters } from '~~/shared/types/dashboard-summary'

/**
 * Строка состояния системы. Источник: `SystemStatusStrip` из макета 01.
 *
 * Каждая плитка ведёт в раздел с уже применённым фильтром — иначе цифра
 * заставляет искать те же объекты руками.
 *
 * В макете есть ещё расход за сутки и состояние интеграций. Их здесь нет:
 * `/api/dashboard/summary` таких величин не считает, а расход по дням живёт
 * в админском разделе балансов и виден не всем.
 */
const props = defineProps<{
  counters: Partial<DashboardCounters>
  pending?: boolean
}>()

const { canAccessModule } = usePermissions()

interface Tile {
  key: keyof DashboardCounters
  label: string
  caption: string
  to: string
  module?: string
  tone?: 'warning' | 'danger'
  live?: boolean
}

const ALL: Tile[] = [
  { key: 'activeRuns', label: 'Запуски сейчас', caption: 'идут прямо сейчас', to: '/pipeline', module: 'pipeline', live: true },
  { key: 'trends', label: 'Тренды', caption: 'всего в базе', to: '/trends', module: 'trendwatcher' },
  { key: 'scenariosOnReview', label: 'Сценарии ждут решения', caption: 'вариант не выбран', to: '/scenarios', module: 'script-generator', tone: 'warning' },
  { key: 'videosFailed', label: 'Ролики упали', caption: 'можно повторить', to: '/videos', module: 'video-generator', tone: 'danger' },
  { key: 'postingQueued', label: 'Публикации в очереди', caption: 'ждут своего времени', to: '/posting-jobs', module: 'social-upload' },
  { key: 'accountsAttention', label: 'Аккаунты с проблемой', caption: 'токен истёк или на исходе', to: '/accounts', module: 'social-upload', tone: 'warning' },
]

const tiles = computed(() =>
  ALL
    .filter(t => !t.module || canAccessModule(t.module))
    .map(t => ({ ...t, value: props.counters[t.key] })),
)

const TONE = { warning: 'text-warning', danger: 'text-danger' } as const
</script>

<template>
  <div class="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-panel md:grid-cols-3 xl:grid-cols-6">
    <NuxtLink
      v-for="tile in tiles"
      :key="tile.key"
      :to="tile.to"
      class="flex flex-col gap-1.5 border-t border-r border-divider p-3 px-3.5 transition-colors duration-(--duration-fast) first:border-t-0 last:border-r-0 hover:bg-card md:border-t-0"
    >
      <span class="text-micro tracking-[.06em] text-subtle uppercase">{{ tile.label }}</span>
      <span class="flex items-baseline gap-2">
        <span
          class="tnum text-2xl font-semibold tracking-[-.02em]"
          :class="tile.value && tile.tone ? TONE[tile.tone] : ''"
        >
          <template v-if="tile.value != null">{{ tile.value }}</template>
          <span v-else-if="pending" class="inline-block h-6 w-8 rounded-sm bg-neutral-bg motion-safe:animate-pulse" />
          <template v-else>—</template>
        </span>
        <span
          v-if="tile.live && tile.value"
          class="flex h-[19px] items-center gap-1.5 rounded-sm border border-info-border bg-info-bg px-1.5 text-micro text-info"
        >
          <span class="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
          идут
        </span>
      </span>
      <span class="text-micro text-subtle">{{ tile.caption }}</span>
    </NuxtLink>
  </div>
</template>
