<script setup lang="ts">
/**
 * Метрика. Источник: design-preview/_system/blocks/MetricStat.html
 *
 * Дельта показывается только когда она есть: «0%» и «—» рядом с каждым числом
 * создают шум, из-за которого настоящие изменения перестают замечать.
 */
const props = defineProps<{
  label: string
  value: string | number
  /** Цель — «43 из 60». */
  target?: string | number
  /** Изменение к прошлому периоду в процентах. */
  delta?: number | null
  deltaCaption?: string
  /** Рост — это хорошо? У расхода и у стоимости заявки наоборот. */
  higherIsBetter?: boolean
  spark?: number[]
}>()

const deltaTone = computed(() => {
  if (props.delta == null || props.delta === 0) return 'text-subtle'
  const good = props.higherIsBetter === false ? props.delta < 0 : props.delta > 0
  return good ? 'text-success' : 'text-danger'
})
</script>

<template>
  <div class="flex gap-4">
    <div class="flex-1">
      <div class="text-[11.5px] text-muted">{{ label }}</div>
      <div class="my-0.5 flex items-baseline gap-2">
        <span class="tnum text-3xl font-semibold tracking-[-.02em]">{{ value }}</span>
        <span v-if="target != null" class="tnum text-base text-subtle">из {{ target }}</span>
      </div>
      <div
        v-if="delta != null"
        class="inline-flex items-center gap-1 text-[11.5px] whitespace-nowrap"
        :class="deltaTone"
      >
        <Icon :name="delta >= 0 ? 'mingcute:arrow-up-line' : 'mingcute:arrow-down-line'" />
        <span class="tnum">{{ delta > 0 ? '+' : '' }}{{ delta }}%</span>
        <span v-if="deltaCaption" class="text-subtle">{{ deltaCaption }}</span>
      </div>
    </div>
    <UiSparkline v-if="spark?.length" :values="spark" />
  </div>
</template>
