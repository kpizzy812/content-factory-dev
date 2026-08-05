<script setup lang="ts">
/**
 * Линейный прогресс по шагам. Источник: design-preview/_system/blocks/Progress.html
 *
 * Сегмент на шаг, а не общая полоса: видно и сколько пройдено, и что упало.
 * Движется только текущий сегмент — при поллинге раз в 5 с общая полоса,
 * которая дёргается на каждом обновлении, невыносима.
 */
type StepState = 'done' | 'running' | 'failed' | 'pending'

defineProps<{
  steps: StepState[]
  label?: string
  caption?: string
}>()

const FILL: Record<StepState, string> = {
  done: 'bg-success',
  running: 'bg-info-bg',
  failed: 'bg-danger',
  pending: 'bg-neutral-bg',
}
</script>

<template>
  <div>
    <div v-if="label || caption" class="mb-1.5 flex justify-between text-sm">
      <span>{{ label }}</span>
      <span v-if="caption" class="tnum font-mono text-muted">{{ caption }}</span>
    </div>
    <div class="flex gap-[3px]">
      <span
        v-for="(state, i) in steps"
        :key="i"
        class="relative h-[5px] flex-1 overflow-hidden rounded-[2px]"
        :class="FILL[state]"
      >
        <span
          v-if="state === 'running'"
          class="absolute inset-y-0 left-0 w-1/3 bg-info motion-safe:animate-pulse"
        />
      </span>
    </div>
  </div>
</template>
