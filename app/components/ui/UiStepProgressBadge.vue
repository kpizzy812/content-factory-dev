<script setup lang="ts">
/**
 * Бейдж прогресса по шагам. Источник: design-preview/_system/blocks/StepProgressBadge.html
 *
 * Столбики, а не процент: оператору важно «сколько шагов осталось», а не доля.
 */
const props = withDefaults(defineProps<{
  current: number
  total: number
  tone?: 'info' | 'success' | 'danger' | 'warning'
}>(), { tone: 'info' })

const toneClass = computed(() => ({
  info: 'bg-info-bg border-info-border text-info',
  success: 'bg-success-bg border-success-border text-success',
  warning: 'bg-warning-bg border-warning-border text-warning',
  danger: 'bg-danger-bg border-danger-border text-danger',
}[props.tone]))

const steps = computed(() =>
  Array.from({ length: Math.max(props.total, 0) }, (_, i) => i < props.current),
)
</script>

<template>
  <span
    class="tnum inline-flex h-[22px] w-fit items-center gap-[7px] rounded-sm border px-2 text-sm whitespace-nowrap"
    :class="toneClass"
  >
    <span class="flex gap-0.5">
      <span
        v-for="(filled, i) in steps"
        :key="i"
        class="h-2.5 w-1 rounded-[1px] bg-current"
        :class="!filled && 'opacity-30'"
      />
    </span>
    {{ current }} из {{ total }} шагов
  </span>
</template>
