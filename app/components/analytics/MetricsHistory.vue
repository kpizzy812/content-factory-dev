<script setup lang="ts">
import type { PostMetrics } from '#shared/types/analytics'

defineProps<{
  metrics: PostMetrics[]
}>()

const COLUMNS = '132px repeat(7, minmax(72px, 1fr))'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <section class="flex flex-col gap-2">
    <h2 class="flex items-center gap-2 text-micro tracking-[.06em] text-subtle uppercase">
      <Icon name="mingcute:history-line" />
      История метрик
    </h2>

    <UiEmptyState
      v-if="!metrics.length"
      title="Метрики ещё не собирались"
      description="Сбор идёт по расписанию после публикации."
    />

    <UiTable v-else :columns="COLUMNS" min-width="720px">
      <UiTableHead>
        <span>Снято</span>
        <span class="text-right">Просмотры</span>
        <span class="text-right">Досмотры</span>
        <span class="text-right">Лайки</span>
        <span class="text-right">Комментарии</span>
        <span class="text-right">Репосты</span>
        <span class="text-right">CTR</span>
        <span class="text-right">Подписчики</span>
      </UiTableHead>

      <UiTableRow v-for="m in metrics" :key="m.id">
        <span class="tnum font-mono text-sm text-muted">{{ formatDate(m.collectedAt) }}</span>
        <span class="tnum text-right font-mono text-sm">{{ formatNumber(m.views) }}</span>
        <span class="tnum text-right font-mono text-sm">{{ m.watchThrough }}%</span>
        <span class="tnum text-right font-mono text-sm">{{ formatNumber(m.likes) }}</span>
        <span class="tnum text-right font-mono text-sm">{{ formatNumber(m.comments) }}</span>
        <span class="tnum text-right font-mono text-sm">{{ formatNumber(m.shares) }}</span>
        <span class="tnum text-right font-mono text-sm">{{ m.ctr.toFixed(1) }}%</span>
        <span class="tnum text-right font-mono text-sm">{{ formatNumber(m.followerGain) }}</span>
      </UiTableRow>
    </UiTable>
  </section>
</template>
