<script setup lang="ts">
/**
 * Динамика по дням: один показатель на графике, переключение сверху.
 *
 * Отметки под осью — публикации за день: всплеск просмотров читается вместе
 * со своей причиной. Незавершённый день заштрихован — данные неполные.
 * Ноль и «нет данных» не смешиваются: у стоимости заявки без заявок столбика
 * нет вовсе.
 */
import type { TimeseriesMetric, TimeseriesResult } from '#shared/types/analytics-funnel'
import { TIMESERIES_LABELS, shortDay, timeseriesValue } from './AnalyticsFunnelFormat'

const props = defineProps<{
  series: TimeseriesResult
}>()

const metric = defineModel<TimeseriesMetric>('metric', { required: true })

const METRICS: TimeseriesMetric[] = ['views', 'clicks', 'leads', 'costPerLead']

const peak = computed(() => Math.max(...props.series.points.map(point => point.value ?? 0), 1))

/** Пять подписей оси: от максимума до нуля. */
const ticks = computed(() => {
  const top = peak.value
  return [1, 0.75, 0.5, 0.25, 0].map(share => timeseriesValue(metric.value, top * share))
})

const publicationPeak = computed(
  () => Math.max(...props.series.points.map(point => point.publications), 1),
)

function barHeight(value: number | null): string {
  if (value == null || value <= 0) return '0%'
  return `${Math.max((value / peak.value) * 100, 2)}%`
}

const HATCH = 'repeating-linear-gradient(135deg, var(--color-accent) 0 5px, transparent 5px 9px)'
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2.5 border-b border-border bg-card px-3 py-2.5">
      <div class="flex rounded-md border border-border bg-panel p-0.5">
        <button
          v-for="item in METRICS"
          :key="item"
          type="button"
          class="h-6 rounded-sm px-2.5 text-micro"
          :class="metric === item ? 'bg-raised text-fg' : 'text-muted hover:text-fg'"
          @click="metric = item"
        >
          {{ TIMESERIES_LABELS[item] }}
        </button>
      </div>
      <span class="ml-auto inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap text-muted">
        <span class="h-2 w-2.5 rounded-[2px] bg-accent" />{{ TIMESERIES_LABELS[metric].toLowerCase() }}
        <span class="ml-2 h-2 w-2 rounded-full bg-info" />публикации за день
      </span>
    </header>

    <div v-if="!series.enoughData" class="px-4 py-6 text-center">
      <div class="text-sm font-medium">Мало данных для графика</div>
      <p class="mx-auto mt-1 max-w-[380px] text-sm text-muted">
        За выбранный период набралось меньше {{ series.minPoints }} непустых дней.
        Расширьте период или снимите отбор по площадке.
      </p>
    </div>

    <div v-else class="px-4 pt-3.5 pb-2.5">
      <div class="flex gap-2">
        <div
          class="tnum flex flex-col justify-between pr-0.5 pb-[22px] text-right font-mono text-[10px] text-subtle"
        >
          <span v-for="(tick, index) in ticks" :key="index">{{ tick }}</span>
        </div>
        <div class="flex h-[180px] flex-1 items-stretch gap-1.5">
          <div
            v-for="point in series.points"
            :key="point.day"
            class="flex flex-1 flex-col justify-end"
            :title="`${point.day} · ${timeseriesValue(metric, point.value)} · публикаций ${point.publications}`"
          >
            <span
              class="rounded-t-[2px]"
              :class="point.partial ? '' : 'bg-accent'"
              :style="{
                height: barHeight(point.value),
                opacity: point.partial ? 0.55 : 0.85,
                ...(point.partial ? { background: HATCH } : {}),
              }"
            />
            <span class="flex h-[22px] flex-col items-center gap-0.5 pt-1">
              <span class="font-mono text-[10px] text-subtle">{{ shortDay(point.day) }}</span>
              <span
                v-if="point.publications > 0"
                class="h-1.5 w-1.5 rounded-full bg-info"
                :style="{ opacity: 0.35 + 0.65 * (point.publications / publicationPeak) }"
              />
            </span>
          </div>
        </div>
      </div>
      <p class="mt-1.5 text-[11px] text-subtle">
        Сегодняшний день заштрихован — данные неполные. Просмотры за день —
        прирост между замерами, а не сумма снимков. Значение и число публикаций
        — при наведении на столбец.
      </p>
    </div>
  </section>
</template>
