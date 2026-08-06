<script setup lang="ts">
import type { AccountMetricsSnapshotDTO } from '~~/shared/types/account-metrics'

/**
 * Динамика подписчиков по снимкам. Не `UiSparkline`: там линия без подписей,
 * а здесь у каждого столбца свои дата и значение в подсказке.
 */
const props = defineProps<{ snapshots: AccountMetricsSnapshotDTO[] }>()

interface Bar {
  id: string
  value: number
  percent: number
  label: string
}

// Сервер отдаёт снимки от новых к старым — для графика разворачиваем.
const bars = computed<Bar[]>(() => {
  const okOnly = props.snapshots
    .filter(s => s.status === 'ok' && s.followers !== null)
    .slice()
    .reverse()

  if (!okOnly.length) return []

  const values = okOnly.map(s => Number(s.followers))
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  // Нижняя граница 10%: иначе самый маленький столбец схлопывается в ничто.
  const range = max - min || 1

  return okOnly.map(s => ({
    id: s.id,
    value: Number(s.followers),
    percent: 10 + ((Number(s.followers) - min) / range) * 90,
    label: `${formatTimestamp(s.fetchedAt)} · ${formatBigInt(s.followers)} подписчиков`,
  }))
})

const maxValueLabel = computed(() => {
  if (!bars.value.length) return ''
  return formatBigInt(String(Math.max(...bars.value.map(b => b.value), 0)))
})

const firstDate = computed(() => {
  if (!bars.value.length) return ''
  return formatTimestamp(props.snapshots[props.snapshots.length - 1]!.fetchedAt)
})

const lastDate = computed(() => {
  if (!bars.value.length) return ''
  return formatTimestamp(props.snapshots[0]!.fetchedAt)
})
</script>

<template>
  <div v-if="bars.length" class="flex flex-col gap-2.5 rounded-md border border-border bg-card p-3">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="flex flex-1 items-center gap-1.5 text-sm font-medium">
        <Icon name="mingcute:chart-line-line" />
        Динамика подписчиков
      </h3>
      <span class="tnum font-mono text-micro text-subtle">максимум {{ maxValueLabel }}</span>
      <span class="tnum font-mono text-micro text-subtle">снимков {{ bars.length }}</span>
    </div>

    <div class="flex h-24 items-end gap-1 overflow-hidden rounded-md bg-surface p-2">
      <div
        v-for="bar in bars"
        :key="bar.id"
        class="min-w-1 flex-1 rounded-t-sm bg-accent transition-opacity duration-(--duration-fast) hover:opacity-80"
        :style="{ height: `${bar.percent}%` }"
        :title="bar.label"
      />
    </div>

    <div class="flex justify-between font-mono text-micro text-subtle">
      <span>{{ firstDate }}</span>
      <span>{{ lastDate }}</span>
    </div>
  </div>

  <p v-else class="text-micro text-subtle">
    Для графика нужен хотя бы один успешный снимок с числом подписчиков.
  </p>
</template>
