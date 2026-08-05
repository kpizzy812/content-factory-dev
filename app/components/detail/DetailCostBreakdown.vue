<script setup lang="ts">
/**
 * Стоимость с разбивкой. Источник: design-preview/catalog/03-detail-video.dc.html
 *
 * Две служебные строки внизу — то, ради чего этот блок нужен:
 * средняя по разделу показывает, дорогой ли объект, а «потрачено на неудачные
 * попытки» объясняет расхождение сметы с фактом и нигде больше не видно.
 */
export interface CostItem {
  label: string
  amount: number
  /** Потрачено на упавшие попытки — считается отдельно. */
  wasted?: boolean
}

const props = defineProps<{
  items: CostItem[]
  /** Средняя стоимость объекта в разделе за сутки. */
  average?: number | null
}>()

const total = computed(() => props.items.reduce((s, i) => s + i.amount, 0))
const wasted = computed(() => props.items.filter(i => i.wasted).reduce((s, i) => s + i.amount, 0))
const max = computed(() => Math.max(...props.items.map(i => i.amount), 0.01))

function rub(n: number) {
  return `${n.toFixed(2)} ₽`
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div class="flex items-baseline justify-between">
      <span class="text-sm text-muted">Стоимость</span>
      <span class="tnum font-mono text-xl font-semibold">{{ rub(total) }}</span>
    </div>

    <div class="flex flex-col gap-1.5">
      <div v-for="item in items" :key="item.label" class="flex items-center gap-2">
        <span class="w-28 shrink-0 truncate text-sm" :class="item.wasted ? 'text-danger' : 'text-muted'">
          {{ item.label }}
        </span>
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-bg">
          <span
            class="block h-full"
            :class="item.wasted ? 'bg-danger' : 'bg-accent'"
            :style="{ width: `${(item.amount / max) * 100}%` }"
          />
        </span>
        <span class="tnum w-16 shrink-0 text-right font-mono text-sm">{{ rub(item.amount) }}</span>
      </div>
    </div>

    <div class="flex flex-col gap-1 border-t border-divider pt-2 text-sm text-subtle">
      <div v-if="average != null" class="flex justify-between">
        <span>Средняя по разделу за сутки</span>
        <span class="tnum font-mono">{{ rub(average) }}</span>
      </div>
      <div v-if="wasted > 0" class="flex justify-between text-danger">
        <span>Потрачено на неудачные попытки</span>
        <span class="tnum font-mono">{{ rub(wasted) }}</span>
      </div>
    </div>
  </div>
</template>
