<script setup lang="ts">
/**
 * Сумма по выборке аккаунтов на вкладке «Аккаунты».
 *
 * `totalFollowers` приходит строкой из BigInt — сериализация снимка не теряет
 * точность на больших числах.
 */
import type { AccountsSummaryAggregate } from '~~/shared/types/analytics'

const props = defineProps<{
  aggregate: AccountsSummaryAggregate
}>()

const tiles = computed(() => [
  {
    key: 'accounts',
    label: 'Аккаунтов',
    value: String(props.aggregate.accountsTotal),
    caption: `со снимками: ${props.aggregate.accountsWithMetrics}`,
  },
  {
    key: 'followers',
    label: 'Сумма подписчиков',
    value: formatBigInt(props.aggregate.totalFollowers),
    caption: 'по последним успешным снимкам',
  },
  {
    key: 'engagement',
    label: 'Средний engagement',
    value: formatEngagementRate(props.aggregate.avgEngagement),
    caption: 'по аккаунтам со снимками',
  },
])
</script>

<template>
  <section class="grid overflow-hidden rounded-lg border border-border bg-panel sm:grid-cols-3">
    <div
      v-for="tile in tiles"
      :key="tile.key"
      class="border-b border-divider px-3 py-2.5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
    >
      <div class="text-[11px] text-muted">{{ tile.label }}</div>
      <div class="tnum my-0.5 font-mono text-lg font-semibold">{{ tile.value }}</div>
      <div class="text-[11px] text-subtle">{{ tile.caption }}</div>
    </div>
  </section>
</template>
