<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    percent: number
    size?: "sm" | "md"
  }>(),
  { size: "md" },
)

const progressColorClass = computed(() => {
  if (props.percent < 50) return "progress-error"
  if (props.percent < 80) return "progress-warning"
  return "progress-success"
})

const textColorClass = computed(() => {
  if (props.percent < 50) return "text-error"
  if (props.percent < 80) return "text-warning"
  return "text-success"
})

const sizeClass = computed(() => (props.size === "sm" ? "h-1" : "h-2"))

const clampedPercent = computed(() => {
  const n = Number.isFinite(props.percent) ? props.percent : 0
  return Math.max(0, Math.min(100, Math.round(n)))
})
</script>

<template>
  <div class="flex items-center gap-2 w-full">
    <progress
      class="progress w-full"
      :class="[progressColorClass, sizeClass]"
      :value="clampedPercent"
      max="100"
      :aria-valuenow="clampedPercent"
    />
    <span class="text-xs font-mono shrink-0 w-10 text-right" :class="textColorClass">
      {{ clampedPercent }}%
    </span>
  </div>
</template>
