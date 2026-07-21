<script setup lang="ts">
import type { DashboardData } from '#shared/types/analytics'

defineProps<{
  data: DashboardData
  totalPosts: number
}>()
</script>

<template>
  <div class="stats stats-vertical sm:stats-horizontal shadow-sm w-full bg-base-100">
    <div class="stat">
      <div class="stat-figure text-primary">
        <Icon name="mingcute:eye-line" class="text-2xl" />
      </div>
      <div class="stat-title">Общие просмотры</div>
      <div class="stat-value text-primary">
        {{ formatNumber(data.totalViews) }}
      </div>
    </div>

    <div class="stat">
      <div class="stat-figure text-secondary">
        <Icon name="mingcute:user-add-line" class="text-2xl" />
      </div>
      <div class="stat-title">Прирост подписчиков</div>
      <div class="stat-value text-secondary">
        {{ formatNumber(data.totalFollowerGain) }}
      </div>
    </div>

    <div class="stat">
      <div class="stat-figure text-accent">
        <Icon name="mingcute:time-line" class="text-2xl" />
      </div>
      <div class="stat-title">Средняя досматриваемость</div>
      <div class="stat-value text-accent">
        {{ data.avgWatchThrough }}%
      </div>
    </div>

    <div class="stat">
      <div class="stat-figure text-info">
        <Icon name="mingcute:video-line" class="text-2xl" />
      </div>
      <div class="stat-title">Всего роликов</div>
      <div class="stat-value text-info">
        {{ totalPosts }}
      </div>
    </div>
  </div>
</template>
