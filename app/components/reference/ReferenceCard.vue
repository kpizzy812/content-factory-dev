<script setup lang="ts">
import type { UploadWithMetrics } from '#shared/types/analytics'

/**
 * Карточка референса — публикации, которую система признала образцовой.
 *
 * Причина попадания в референсы стоит текстом, а не свёрнута: без неё
 * непонятно, что именно повторять в следующем ролике.
 */
defineProps<{
  id: number
  uploadId: number
  reason: string
  addedAt: string
  upload: UploadWithMetrics
}>()

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}
</script>

<template>
  <div class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
    <div class="flex items-start gap-2">
      <h3 class="min-w-0 flex-1 text-sm font-medium">{{ upload.title || 'Без названия' }}</h3>
      <UiPlatformBadge v-if="upload.socialAccount?.platform" :platform="upload.socialAccount.platform" />
    </div>

    <div v-if="upload.latestMetrics" class="flex flex-wrap gap-3 text-sm text-muted">
      <span class="tnum flex items-center gap-1 font-mono">
        <Icon name="mingcute:eye-line" class="text-subtle" />
        {{ formatNumber(upload.latestMetrics.views) }}
      </span>
      <span class="tnum flex items-center gap-1 font-mono">
        <Icon name="mingcute:time-line" class="text-subtle" />
        {{ upload.latestMetrics.watchThrough }}%
      </span>
      <span class="tnum flex items-center gap-1 font-mono">
        <Icon name="mingcute:heart-line" class="text-subtle" />
        {{ formatNumber(upload.latestMetrics.likes) }}
      </span>
    </div>

    <p class="line-clamp-3 text-sm text-muted">{{ reason }}</p>

    <div class="flex items-center gap-2">
      <span class="tnum font-mono text-micro text-subtle">{{ formatDate(addedAt) }}</span>
      <NuxtLink :to="`/analytics/${uploadId}`" class="ml-auto">
        <UiButton variant="ghost">
          Подробнее
          <Icon name="mingcute:right-line" />
        </UiButton>
      </NuxtLink>
    </div>
  </div>
</template>
