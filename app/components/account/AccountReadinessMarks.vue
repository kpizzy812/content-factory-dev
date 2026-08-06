<script setup lang="ts">
import { readinessMarks, type ReadinessAccount } from './AccountReadinessMap'

/**
 * Отметки готовности строкой. Источник: design-preview/catalog/06-accounts-queue.dc.html,
 * блок `ReadinessMarks`.
 */
const props = defineProps<{ account: ReadinessAccount }>()

const marks = computed(() => readinessMarks(props.account))

const TONE = {
  ok: 'border-success-border bg-success-bg text-success',
  warn: 'border-warning bg-panel text-warning',
  fail: 'border-danger bg-danger-bg text-danger',
  none: 'border-dashed border-border bg-surface text-subtle',
} as const
</script>

<template>
  <span class="flex gap-1">
    <span
      v-for="mark in marks"
      :key="mark.code"
      class="flex h-5 w-7 shrink-0 items-center justify-center rounded-sm border font-mono text-[9.5px]"
      :class="TONE[mark.tone]"
      :title="`${mark.label}: ${mark.detail}`"
    >{{ mark.code }}</span>
  </span>
</template>
