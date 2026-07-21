<script setup lang="ts">
/**
 * Верхняя плашка статистики в /analytics → таб «Аккаунты».
 * Сумма по выборке аккаунтов: всего, со снапшотами, сумма followers,
 * средний engagement. totalFollowers — string из BigInt (serializeSnapshot).
 */
import type { AccountsSummaryAggregate } from "~~/shared/types/analytics"

defineProps<{
  aggregate: AccountsSummaryAggregate
}>()
</script>

<template>
  <div class="stats stats-vertical sm:stats-horizontal shadow-sm w-full bg-base-100">
    <div class="stat">
      <div class="stat-figure text-primary">
        <Icon name="mingcute:group-line" class="text-2xl" />
      </div>
      <div class="stat-title">Аккаунтов</div>
      <div class="stat-value text-primary">
        {{ aggregate.accountsTotal }}
      </div>
      <div class="stat-desc text-xs">
        со снапшотами: {{ aggregate.accountsWithMetrics }}
      </div>
    </div>

    <div class="stat">
      <div class="stat-figure text-secondary">
        <Icon name="mingcute:user-following-line" class="text-2xl" />
      </div>
      <div class="stat-title">Сумма подписчиков</div>
      <div class="stat-value text-secondary">
        {{ formatBigInt(aggregate.totalFollowers) }}
      </div>
      <div class="stat-desc text-xs">
        по последним 'ok'-снимкам
      </div>
    </div>

    <div class="stat">
      <div class="stat-figure text-accent">
        <Icon name="mingcute:heart-line" class="text-2xl" />
      </div>
      <div class="stat-title">Средний engagement</div>
      <div class="stat-value text-accent">
        {{ formatEngagementRate(aggregate.avgEngagement) }}
      </div>
      <div class="stat-desc text-xs">
        по аккаунтам со снимками
      </div>
    </div>
  </div>
</template>
