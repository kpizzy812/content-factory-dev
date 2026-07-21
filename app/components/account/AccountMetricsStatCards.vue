<script setup lang="ts">
import type { AccountMetricsSnapshotDTO } from "~~/shared/types/account-metrics"

// formatBigInt, formatEngagementRate, formatTimestamp — auto-imports
// из app/utils/format-bigint.ts

const props = defineProps<{
  snapshot: AccountMetricsSnapshotDTO
}>()

const fetchedAtLabel = computed(() => formatTimestamp(props.snapshot.fetchedAt))
</script>

<template>
  <div class="space-y-2">
    <div class="text-xs text-base-content/60 flex items-center gap-1">
      <Icon name="mingcute:time-line" class="text-sm" />
      Снимок от {{ fetchedAtLabel }}
      <span v-if="snapshot.isVerified" class="badge badge-xs badge-soft badge-info ml-2">
        <Icon name="mingcute:check-circle-line" class="text-xs" />
        verified
      </span>
    </div>

    <div class="stats stats-vertical sm:stats-horizontal shadow w-full">
      <div class="stat">
        <div class="stat-figure text-primary">
          <Icon name="mingcute:user-following-line" class="text-2xl" />
        </div>
        <div class="stat-title text-xs">Подписчики</div>
        <div class="stat-value text-2xl">{{ formatBigInt(snapshot.followers) }}</div>
      </div>

      <div class="stat">
        <div class="stat-figure text-secondary">
          <Icon name="mingcute:eye-line" class="text-2xl" />
        </div>
        <div class="stat-title text-xs">Всего просмотров</div>
        <div class="stat-value text-2xl">{{ formatBigInt(snapshot.totalViews) }}</div>
        <div v-if="snapshot.totalViews === null" class="stat-desc text-xs">
          Платформа не отдаёт
        </div>
      </div>

      <div class="stat">
        <div class="stat-figure text-accent">
          <Icon name="mingcute:document-line" class="text-2xl" />
        </div>
        <div class="stat-title text-xs">Постов</div>
        <div class="stat-value text-2xl">
          {{ snapshot.postsCount === null ? "—" : snapshot.postsCount }}
        </div>
      </div>

      <div class="stat">
        <div class="stat-figure text-success">
          <Icon name="mingcute:heart-line" class="text-2xl" />
        </div>
        <div class="stat-title text-xs">Engagement</div>
        <div class="stat-value text-2xl">{{ formatEngagementRate(snapshot.engagementRate) }}</div>
        <div class="stat-desc text-xs">по последним постам</div>
      </div>
    </div>

    <div v-if="snapshot.bio" class="text-xs text-base-content/70 italic px-2">
      {{ snapshot.bio.slice(0, 200) }}
    </div>
  </div>
</template>
