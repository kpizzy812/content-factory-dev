<script setup lang="ts">
/** Полнота заполнения аккаунта. Цвет — из общей палитры состояний. */
const props = withDefaults(defineProps<{
  percent: number
  size?: 'sm' | 'md'
}>(), { size: 'md' })

const clamped = computed(() => {
  const n = Number.isFinite(props.percent) ? props.percent : 0
  return Math.max(0, Math.min(100, Math.round(n)))
})

const tone = computed(() => {
  if (clamped.value < 50) return { bar: 'bg-danger', text: 'text-danger' }
  if (clamped.value < 80) return { bar: 'bg-warning', text: 'text-warning' }
  return { bar: 'bg-success', text: 'text-success' }
})
</script>

<template>
  <div class="flex w-full items-center gap-2">
    <span
      class="flex-1 overflow-hidden rounded-full bg-neutral-bg"
      :class="size === 'sm' ? 'h-1' : 'h-1.5'"
      role="progressbar"
      :aria-valuenow="clamped"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span class="block h-full rounded-full" :class="tone.bar" :style="{ width: `${clamped}%` }" />
    </span>
    <span class="tnum w-9 shrink-0 text-right font-mono text-micro" :class="tone.text">{{ clamped }}%</span>
  </div>
</template>
