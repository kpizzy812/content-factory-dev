<script setup lang="ts">
import type { PostingJobStatus } from '~~/shared/types/posting-job'
import { POSTING_STATUS_LABELS, postingStatus } from './PostingStatusMap'

/**
 * Статус задачи постинга: тон общий, подпись доменная. «Повтор» и «Упала» —
 * разные вещи: первое произойдёт само, второе ждёт человека.
 */
const props = withDefaults(defineProps<{
  status: PostingJobStatus
  size?: 'xs' | 'sm' | 'md'
}>(), { size: 'sm' })

const entity = computed(() => postingStatus(props.status))
const label = computed(() => POSTING_STATUS_LABELS[props.status] ?? props.status)

const tone = computed(() => ({
  draft: 'border-neutral-border bg-neutral-bg text-neutral',
  queued: 'border-accent-border bg-accent-bg text-fg',
  running: 'border-info-border bg-info-bg text-info',
  review: 'border-warning-border bg-warning-bg text-warning',
  done: 'border-success-border bg-success-bg text-success',
  failed: 'border-danger-border bg-danger-bg text-danger',
  blocked: 'border-dashed border-danger-border bg-surface text-danger',
  cancelled: 'border-divider bg-transparent text-subtle',
}[entity.value]))

const sizing = computed(() => ({
  xs: 'h-[18px] gap-1 px-1.5 text-micro',
  sm: 'h-[22px] gap-1.5 px-2 text-sm',
  md: 'h-[26px] gap-1.5 px-2.5 text-base',
}[props.size]))
</script>

<template>
  <span class="inline-flex w-fit items-center rounded-sm border whitespace-nowrap" :class="[tone, sizing]">
    <span
      class="size-1.5 shrink-0 rounded-full bg-current"
      :class="entity === 'running' && 'motion-safe:animate-pulse'"
    />
    {{ label }}
  </span>
</template>
