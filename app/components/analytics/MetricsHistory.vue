<script setup lang="ts">
import type { PostMetrics } from '#shared/types/analytics'

defineProps<{
  metrics: PostMetrics[]
}>()

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body">
      <h2 class="card-title text-base">
        <Icon name="mingcute:history-line" class="text-info" />
        История метрик
      </h2>

      <div v-if="metrics.length === 0" class="text-base-content/60 text-sm py-2">
        Метрики еще не собирались
      </div>

      <div v-else class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Просмотры</th>
              <th>Досмотры%</th>
              <th>Лайки</th>
              <th>Комменты</th>
              <th>Шеры</th>
              <th>CTR</th>
              <th>Подписчики</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in metrics" :key="m.id">
              <td class="whitespace-nowrap text-base-content/70">{{ formatDate(m.collectedAt) }}</td>
              <td>{{ formatNumber(m.views) }}</td>
              <td>{{ m.watchThrough }}%</td>
              <td>{{ formatNumber(m.likes) }}</td>
              <td>{{ formatNumber(m.comments) }}</td>
              <td>{{ formatNumber(m.shares) }}</td>
              <td>{{ m.ctr.toFixed(1) }}%</td>
              <td>{{ formatNumber(m.followerGain) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
