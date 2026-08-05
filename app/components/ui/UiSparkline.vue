<script setup lang="ts">
/**
 * Спарклайн столбиками. Источник: design-preview/_system/blocks/MetricStat.html
 *
 * Последний столбик акцентный — он и есть «сейчас». Остальные нейтральные:
 * спарклайн показывает форму, а не значения, и не должен спорить с метрикой.
 */
const props = withDefaults(defineProps<{
  values: number[]
  height?: number
  width?: number
}>(), { height: 52, width: 88 })

const bars = computed(() => {
  const max = Math.max(...props.values, 1)
  return props.values.map(v => Math.max(Math.round((v / max) * 100), 4))
})
</script>

<template>
  <div class="flex items-end gap-[3px]" :style="{ width: `${width}px`, height: `${height}px` }">
    <span
      v-for="(h, i) in bars"
      :key="i"
      class="flex-1 rounded-[1px]"
      :class="i === bars.length - 1 ? 'bg-accent' : 'bg-neutral-bg'"
      :style="{ height: `${h}%` }"
    />
  </div>
</template>
