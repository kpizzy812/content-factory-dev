<script setup lang="ts">
/**
 * Карточка производственного цикла.
 * Четыре счётчика — это и есть цикл: тренды → сценарии → ролики → публикации.
 */
import { cycleStatus } from './CycleStatusMap'

const props = defineProps<{
  cycle: {
    id: number
    status: string
    app: { id: number, name: string } | null
    trendsFound: number
    scenariosGen: number
    videosGen: number
    uploadsCount: number
    startedAt: string
    createdAt: string
  }
}>()

const counters = computed(() => [
  { label: 'Тренды', value: props.cycle.trendsFound },
  { label: 'Сценарии', value: props.cycle.scenariosGen },
  { label: 'Ролики', value: props.cycle.videosGen },
  { label: 'Публикации', value: props.cycle.uploadsCount },
])

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <NuxtLink
    :to="`/admin/cycles/${cycle.id}`"
    class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors duration-(--duration-fast) hover:border-subtle"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="font-mono text-micro text-subtle">cyc_{{ cycle.id }}</span>
      <span class="min-w-0 flex-1 truncate font-medium">
        {{ cycle.app?.name ?? 'Без приложения' }}
      </span>
      <UiStatusBadge :status="cycleStatus(cycle.status)" size="xs" />
    </div>

    <div class="flex flex-wrap gap-x-5 gap-y-1">
      <span v-for="c in counters" :key="c.label" class="text-sm text-muted">
        {{ c.label }} <span class="tnum font-mono text-fg">{{ c.value }}</span>
      </span>
    </div>

    <span class="tnum font-mono text-micro text-subtle">{{ formatDate(cycle.createdAt) }}</span>
  </NuxtLink>
</template>
