<script setup lang="ts">
import { formatRate } from './AnalyticsFormat'
import type { UploadWithMetrics } from '#shared/types/analytics'

defineProps<{
  posts: UploadWithMetrics[]
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
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body">
      <h2 class="card-title text-base">
        <Icon name="mingcute:trophy-line" class="text-warning" />
        Топ-5 по CTR
      </h2>
      <div v-if="posts.length === 0" class="text-base-content/60 text-sm py-2">
        Нет данных по CTR
      </div>
      <div v-else class="space-y-2">
        <NuxtLink
          v-for="(post, index) in posts"
          :key="post.id"
          :to="`/analytics/${post.id}`"
          class="flex items-center gap-3 p-2 rounded-box hover:bg-base-200 transition-colors"
        >
          <span class="font-mono text-base-content/40 w-5 text-center">{{ index + 1 }}</span>
          <div class="flex-1 min-w-0">
            <p class="truncate text-sm font-medium text-base-content">
              {{ post.title || 'Без названия' }}
            </p>
          </div>
          <span
            class="badge badge-sm"
            :class="platformColors[post.socialAccount?.platform ?? ''] ?? 'badge-ghost'"
          >
            {{ platformLabels[post.socialAccount?.platform ?? ''] ?? post.socialAccount?.platform }}
          </span>
          <span class="font-semibold text-sm text-primary whitespace-nowrap">
            {{ formatRate(post.latestMetrics?.ctr) }}
          </span>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
