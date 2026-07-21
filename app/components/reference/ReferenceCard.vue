<script setup lang="ts">
import type { UploadWithMetrics } from '#shared/types/analytics'

defineProps<{
  id: number
  uploadId: number
  reason: string
  addedAt: string
  upload: UploadWithMetrics
}>()

const platformLabels: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}

const platformColors: Record<string, string> = {
  youtube: 'badge-error',
  tiktok: 'badge-neutral',
  instagram: 'badge-secondary',
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm card-border">
    <div class="card-body">
      <div class="flex items-start justify-between gap-2">
        <h3 class="card-title text-sm">
          {{ upload.title || 'Без названия' }}
        </h3>
        <span
          class="badge badge-sm shrink-0"
          :class="platformColors[upload.socialAccount?.platform ?? ''] ?? 'badge-ghost'"
        >
          {{ platformLabels[upload.socialAccount?.platform ?? ''] ?? '---' }}
        </span>
      </div>

      <div v-if="upload.latestMetrics" class="flex flex-wrap gap-3 text-sm text-base-content/70 mt-1">
        <span class="flex items-center gap-1">
          <Icon name="mingcute:eye-line" class="text-xs" />
          {{ formatNumber(upload.latestMetrics.views) }}
        </span>
        <span class="flex items-center gap-1">
          <Icon name="mingcute:time-line" class="text-xs" />
          {{ upload.latestMetrics.watchThrough }}%
        </span>
        <span class="flex items-center gap-1">
          <Icon name="mingcute:heart-line" class="text-xs" />
          {{ formatNumber(upload.latestMetrics.likes) }}
        </span>
      </div>

      <p class="text-sm text-base-content/60 mt-2 line-clamp-3">
        {{ reason }}
      </p>

      <div class="card-actions justify-between items-center mt-2">
        <span class="text-xs text-base-content/40">
          {{ formatDate(addedAt) }}
        </span>
        <NuxtLink
          :to="`/analytics/${uploadId}`"
          class="btn btn-ghost btn-xs"
        >
          Подробнее
          <Icon name="mingcute:arrow-right-line" />
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
