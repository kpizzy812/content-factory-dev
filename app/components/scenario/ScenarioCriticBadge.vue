<script setup lang="ts">
const props = defineProps<{
  /** totalScore 0..100 или null если ещё не оценено */
  score: number | null
  /** Размер бейджа (DaisyUI). Default 'sm'. */
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>()

const size = computed(() => props.size ?? 'sm')

const badgeColorClass = computed(() => {
  if (props.score === null || props.score === undefined) return 'badge-ghost'
  if (props.score >= 80) return 'badge-success'
  if (props.score >= 70) return 'badge-warning'
  return 'badge-error'
})

const sizeClass = computed(() => `badge-${size.value}`)

const label = computed(() => {
  if (props.score === null || props.score === undefined) return '?'
  return String(Math.round(props.score))
})

const tooltip = computed(() => {
  if (props.score === null || props.score === undefined) return 'Не проверено критиком'
  if (props.score >= 80) return `Качество: ${Math.round(props.score)}/100 (отлично)`
  if (props.score >= 70) return `Качество: ${Math.round(props.score)}/100 (с замечаниями)`
  return `Качество: ${Math.round(props.score)}/100 (требует доработки)`
})
</script>

<template>
  <span
    class="badge gap-1"
    :class="[badgeColorClass, sizeClass]"
    :title="tooltip"
    :aria-label="tooltip"
  >
    <Icon name="mingcute:star-line" class="text-xs" aria-hidden="true" />
    {{ label }}
  </span>
</template>
