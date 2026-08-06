<script setup lang="ts">
/**
 * Оценка критика 0..100. Не статус сущности, поэтому UiStatusBadge не подходит —
 * берём из системы только тон: ниже порога это предупреждение, а не «ошибка».
 */
const props = withDefaults(defineProps<{
  score: number | null
  size?: 'xs' | 'sm'
}>(), { size: 'sm' })

const tone = computed(() => {
  if (props.score == null) return 'border-divider text-subtle'
  if (props.score >= 80) return 'border-success-border bg-success-bg text-success'
  if (props.score >= 70) return 'border-warning-border bg-warning-bg text-warning'
  return 'border-danger-border bg-danger-bg text-danger'
})

const sizing = computed(() => props.size === 'xs'
  ? 'h-[18px] gap-1 px-1.5 text-micro'
  : 'h-[22px] gap-[5px] px-2 text-sm')

const label = computed(() => props.score == null ? '?' : String(Math.round(props.score)))

const tooltip = computed(() => {
  if (props.score == null) return 'Критик ещё не оценивал'
  const n = Math.round(props.score)
  if (props.score >= 80) return `Качество ${n}/100 — отлично`
  if (props.score >= 70) return `Качество ${n}/100 — с замечаниями`
  return `Качество ${n}/100 — требует доработки`
})
</script>

<template>
  <span
    class="tnum inline-flex w-fit items-center rounded-sm border font-mono whitespace-nowrap"
    :class="[sizing, tone]"
    :title="tooltip"
    :aria-label="tooltip"
  >
    <Icon name="mingcute:star-line" class="shrink-0" aria-hidden="true" />
    {{ label }}
  </span>
</template>
