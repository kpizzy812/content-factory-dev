<script setup lang="ts">
/**
 * Строка KPI периода с дельтой к прошлому окну той же длины.
 *
 * У долей дельта в процентных пунктах, у счётчиков — в процентах: «CTR упал
 * на 33 %» и «CTR упал на 0,14 пп» — разные утверждения, и проверяемо второе.
 */
import type { AnalyticsKpi } from '#shared/types/analytics-funnel'
import { kpiDelta, kpiValue } from './AnalyticsFunnelFormat'

const props = defineProps<{
  kpis: AnalyticsKpi[]
}>()

const TONE: Record<string, string> = {
  success: 'text-success',
  danger: 'text-danger',
  subtle: 'text-subtle',
}

const items = computed(() => props.kpis.map(kpi => ({
  key: kpi.key,
  label: kpi.label,
  value: kpiValue(kpi),
  delta: kpiDelta(kpi),
})))
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
      <div
        v-for="item in items"
        :key="item.key"
        class="border-r border-b border-divider px-3 py-2.5 last:border-r-0 xl:border-b-0"
      >
        <div class="text-[11px] text-muted">{{ item.label }}</div>
        <div class="tnum my-0.5 font-mono text-lg font-semibold">{{ item.value }}</div>
        <div v-if="item.delta" class="tnum text-[11px]" :class="TONE[item.delta.tone]">
          {{ item.delta.text }}
        </div>
        <div v-else class="text-[11px] text-subtle">не с чем сравнить</div>
      </div>
    </div>
    <p class="border-t border-divider px-3 py-1.5 text-[11px] text-subtle">
      Заявки и продажи считаются по последнему касанию — так же, как их видит
      CRM. Рейтинги ниже по умолчанию считаются по первому. Стоимость заявки —
      расход на ролики, завершённые за окно, делённый на заявки этого окна.
    </p>
  </section>
</template>
