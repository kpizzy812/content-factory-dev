<script setup lang="ts">
import type { AccountMetricsSnapshotDTO } from '~~/shared/types/account-metrics'

/**
 * Ключевые числа последнего снимка метрик.
 * `formatBigInt`, `formatEngagementRate` и `formatTimestamp` — авто-импорты
 * из `app/utils/format-bigint.ts`.
 */
const props = defineProps<{ snapshot: AccountMetricsSnapshotDTO }>()

const fetchedAtLabel = computed(() => formatTimestamp(props.snapshot.fetchedAt))
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2 text-micro text-subtle">
      <Icon name="mingcute:time-line" />
      Снимок от {{ fetchedAtLabel }}
      <span
        v-if="snapshot.isVerified"
        class="flex items-center gap-1 rounded-sm border border-info-border bg-info-bg px-1.5 text-info"
      >
        <Icon name="mingcute:check-circle-line" />
        подтверждён платформой
      </span>
    </div>

    <div class="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-panel p-3 sm:grid-cols-4">
      <UiMetricStat label="Подписчики" :value="formatBigInt(snapshot.followers)" />
      <UiMetricStat
        label="Всего просмотров"
        :value="snapshot.totalViews === null ? 'нет данных' : formatBigInt(snapshot.totalViews)"
      />
      <UiMetricStat label="Постов" :value="snapshot.postsCount === null ? '—' : snapshot.postsCount" />
      <UiMetricStat label="Вовлечённость" :value="formatEngagementRate(snapshot.engagementRate)" />
    </div>

    <p v-if="snapshot.bio" class="text-sm text-muted italic">{{ snapshot.bio.slice(0, 200) }}</p>
  </div>
</template>
