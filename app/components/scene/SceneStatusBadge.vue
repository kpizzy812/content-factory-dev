<script setup lang="ts">
import type { SceneStatus } from '~~/shared/types/scene'
import { SCENE_STATUS_LABELS } from '~~/shared/types/scene'
import { sceneStatus } from './SceneStatusMap'

/**
 * Статус сцены: тон из общего словаря, подпись доменная.
 *
 * «Готова» и «Готовое видео» — разные вещи, и общий словарь их не различает:
 * первое про собранные блоки, второе про уже отснятый ролик.
 */
const props = withDefaults(defineProps<{
  status: SceneStatus
  size?: 'xs' | 'sm' | 'md'
}>(), { size: 'sm' })

const label = computed(() => SCENE_STATUS_LABELS[props.status] ?? props.status)
const entity = computed(() => sceneStatus(props.status))

const tone = computed(() => ({
  draft: 'border-neutral-border bg-neutral-bg text-neutral',
  queued: 'border-neutral-border bg-neutral-bg text-neutral',
  running: 'border-info-border bg-info-bg text-info',
  review: 'border-warning-border bg-warning-bg text-warning',
  done: 'border-success-border bg-success-bg text-success',
  failed: 'border-danger-border bg-danger-bg text-danger',
  blocked: 'border-danger-border bg-danger-bg text-danger',
  cancelled: 'border-divider bg-transparent text-subtle',
}[entity.value]))

const sizing = computed(() => ({
  xs: 'h-[18px] gap-1 px-1.5 text-micro',
  sm: 'h-[22px] gap-[5px] px-2 text-sm',
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
