<script setup lang="ts">
import type { AccountMetricsSnapshotDTO } from "~~/shared/types/account-metrics"

// formatBigInt, formatTimestamp — auto-imports из app/utils/format-bigint.ts

const props = defineProps<{
  snapshots: AccountMetricsSnapshotDTO[]
}>()

interface Bar {
  id: string
  value: number
  percent: number
  label: string
  rawFollowers: string | null
}

// Серверная сортировка — DESC по fetchedAt. Для sparkline разворачиваем в ASC.
const bars = computed<Bar[]>(() => {
  const okOnly = props.snapshots
    .filter((s) => s.status === "ok" && s.followers !== null)
    .slice()
    .reverse()

  if (okOnly.length === 0) return []

  const values = okOnly.map((s) => Number(s.followers))
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  // Шкалируем относительно [min..max], min=10% чтобы маленькие бары были видны
  const range = max - min || 1

  return okOnly.map((s, i) => {
    const v = Number(s.followers)
    const percent = 10 + ((v - min) / range) * 90
    return {
      id: s.id,
      value: v,
      percent,
      label: `${formatTimestamp(s.fetchedAt)}\n${formatBigInt(s.followers)} подписчиков`,
      rawFollowers: s.followers,
    }
  })
})

const maxValueLabel = computed(() => {
  if (bars.value.length === 0) return ""
  const max = Math.max(...bars.value.map((b) => b.value), 0)
  return formatBigInt(String(max))
})

const firstDate = computed(() => {
  if (bars.value.length === 0) return ""
  const lastIndex = props.snapshots.length - 1
  return formatTimestamp(props.snapshots[lastIndex]!.fetchedAt)
})

const lastDate = computed(() => {
  if (bars.value.length === 0) return ""
  return formatTimestamp(props.snapshots[0]!.fetchedAt)
})
</script>

<template>
  <div v-if="bars.length > 0" class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <div class="flex items-center justify-between">
        <h3 class="card-title text-sm">
          <Icon name="mingcute:chart-line-line" class="text-sm" />
          Динамика подписчиков
        </h3>
        <div class="flex items-center gap-3 text-xs text-base-content/60">
          <span title="Максимум на графике">max: {{ maxValueLabel }}</span>
          <span>{{ bars.length }} {{ bars.length === 1 ? "снимок" : "снимков" }}</span>
        </div>
      </div>

      <div class="flex items-end gap-1 h-24 bg-base-200 rounded-box p-2 overflow-hidden">
        <div
          v-for="bar in bars"
          :key="bar.id"
          class="flex-1 min-w-1 bg-primary rounded-t transition-all hover:opacity-80"
          :style="{ height: bar.percent + '%' }"
          :title="bar.label"
        />
      </div>

      <div class="flex justify-between text-xs text-base-content/60">
        <span>{{ firstDate }}</span>
        <span>{{ lastDate }}</span>
      </div>
    </div>
  </div>

  <div v-else class="text-xs text-base-content/50 italic px-2">
    Недостаточно данных для графика — нужен хотя бы один 'ok'-снимок с followers
  </div>
</template>
