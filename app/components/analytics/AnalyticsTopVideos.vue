<script setup lang="ts">
/**
 * Топ роликов по заявкам. Клик по строке открывает разбор публикации —
 * ту самую цепочку от тренда до продажи.
 */
import type { RankedVideo } from '#shared/types/analytics-funnel'
import { formatCount } from './AnalyticsFormat'

defineProps<{
  videos: RankedVideo[]
  selectedUploadId: number | null
}>()

defineEmits<{
  select: [uploadId: number]
}>()

const COLUMNS = 'grid-cols-[26px_minmax(0,1fr)_84px_74px_64px]'
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex items-center gap-2.5 border-b border-border bg-card px-3 py-2.5">
      <span class="text-sm font-semibold">Топ роликов по заявкам</span>
      <span class="ml-auto text-micro text-subtle">клик открывает разбор</span>
    </header>

    <UiEmptyState
      v-if="!videos.length"
      title="Заявок за период нет"
      description="Рейтинг строится по событиям атрибуции: пока их нет, сравнивать нечего."
    />

    <template v-else>
      <button
        v-for="(video, index) in videos"
        :key="video.uploadId"
        type="button"
        class="grid h-10 w-full items-center gap-x-2.5 border-b border-divider px-3 text-left hover:bg-card"
        :class="[COLUMNS, selectedUploadId === video.uploadId ? 'bg-card' : '']"
        @click="$emit('select', video.uploadId)"
      >
        <span class="font-mono text-[11px] text-subtle">{{ index + 1 }}</span>
        <span class="min-w-0">
          <span class="block truncate text-sm">{{ video.title }}</span>
          <span class="block truncate font-mono text-[10.5px] text-subtle">
            {{ video.code }}<template v-if="video.accountName"> · {{ video.accountName }}</template>
          </span>
        </span>
        <span class="tnum text-right font-mono text-micro">{{ formatCount(video.views) }}</span>
        <span class="tnum text-right font-mono text-micro">{{ formatCount(video.clicks) }}</span>
        <span class="tnum text-right font-mono text-sm font-semibold">{{ video.leads }}</span>
      </button>

      <div
        class="grid h-7 items-center gap-x-2.5 bg-card px-3 text-[10.5px] tracking-[.06em] text-subtle uppercase"
        :class="COLUMNS"
      >
        <span /><span />
        <span class="text-right">просмотры</span>
        <span class="text-right">переходы</span>
        <span class="text-right">заявки</span>
      </div>
    </template>
  </section>
</template>
