<script setup lang="ts">
/**
 * Длительности шагов. Источник: design-preview/catalog/05-run-monitor.dc.html
 *
 * Полосы нейтральные: содержание здесь — длина, а не цвет. Цветом отмечены
 * только отклонения — упавший шаг и шаг, который съел больше половины запуска.
 *
 * «Норму» по типу ноды взять неоткуда: истории длительностей по нодам нет ни в
 * одном endpoint, поэтому порог считается от самого запуска.
 */
import type { WorkflowStep } from '~~/shared/types/workflow'
import { durationBetween, formatClock, formatDuration } from '../PipelineRunFormat'

const props = defineProps<{
  steps: WorkflowStep[]
  runStartedAt: string
  runFinishedAt: string | null
  now: number | null
}>()

/** Доля запуска, после которой шаг подсвечивается как затянувшийся. */
const HEAVY_SHARE = 0.5

const startMs = computed(() => new Date(props.runStartedAt).getTime())
const endMs = computed(() => {
  if (props.runFinishedAt) return new Date(props.runFinishedAt).getTime()
  return props.now ?? startMs.value
})
const totalMs = computed(() => Math.max(1, endMs.value - startMs.value))

interface Bar {
  id: number
  index: number
  name: string
  status: string
  left: number
  width: number
  duration: number | null
  heavy: boolean
}

const bars = computed<Bar[]>(() =>
  props.steps.map((step, index) => {
    const ms = step.duration ?? durationBetween(step.startedAt, step.finishedAt, props.now ?? undefined)
    const from = step.startedAt ? new Date(step.startedAt).getTime() : null
    const left = from == null ? 0 : ((from - startMs.value) / totalMs.value) * 100
    const width = ms == null ? 0 : (ms / totalMs.value) * 100
    return {
      id: step.id,
      index,
      name: step.nodeName || step.nodeId,
      status: step.status,
      left: Math.min(100, Math.max(0, left)),
      width: Math.min(100, Math.max(ms == null ? 0 : 0.6, width)),
      duration: ms,
      heavy: ms != null && ms / totalMs.value >= HEAVY_SHARE,
    }
  }),
)

const heaviest = computed(() => {
  const list = bars.value.filter(b => b.heavy && b.status !== 'failed')
  return list.length ? list.reduce((a, b) => (b.duration ?? 0) > (a.duration ?? 0) ? b : a) : null
})

/** Пять отметок по оси времени — как в макете. */
const ticks = computed(() => {
  const out: string[] = []
  for (let i = 0; i < 5; i++) {
    out.push(formatClock(new Date(startMs.value + (totalMs.value * i) / 4).toISOString(), false))
  }
  return out
})

function barTone(bar: Bar) {
  if (bar.status === 'failed') return 'bg-danger'
  if (bar.heavy) return 'bg-warning'
  return 'bg-neutral'
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="flex flex-wrap items-center gap-3 border-b border-border bg-card px-3.5 py-2.5">
      <span class="text-micro tracking-[.06em] text-subtle uppercase">
        Всего {{ formatDuration(totalMs) }}
      </span>
      <span class="flex-1" />
      <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span class="h-2 w-2.5 rounded-[2px] bg-neutral" />норма
        <span class="ml-2 h-2 w-2.5 rounded-[2px] bg-warning" />более половины запуска
        <span class="ml-2 h-2 w-2.5 rounded-[2px] bg-danger" />упал
      </span>
    </div>

    <div class="flex flex-col gap-[7px] px-3.5 py-3">
      <div
        v-for="bar in bars"
        :key="bar.id"
        class="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-x-3 gap-y-1 sm:grid-cols-[184px_minmax(0,1fr)_84px]"
      >
        <span
          class="flex min-w-0 items-center gap-1.5 text-sm"
          :class="bar.status === 'failed' ? 'text-danger' : bar.heavy ? 'text-warning' : 'text-fg'"
        >
          <Icon
            v-if="bar.status === 'failed'"
            name="mingcute:alert-line"
            class="shrink-0"
          />
          <Icon v-else-if="bar.heavy" name="mingcute:time-line" class="shrink-0" />
          <span class="truncate">{{ bar.index + 1 }} · {{ bar.name }}</span>
        </span>
        <span class="relative col-span-2 h-3.5 rounded-[2px] bg-card sm:col-span-1">
          <span
            v-if="bar.duration != null"
            class="absolute inset-y-0 rounded-[2px]"
            :class="barTone(bar)"
            :style="{ left: `${bar.left}%`, width: `${bar.width}%` }"
          />
        </span>
        <span
          class="tnum text-right font-mono text-sm"
          :class="bar.status === 'failed' ? 'text-danger' : bar.heavy ? 'text-warning' : 'text-muted'"
        >{{ bar.duration == null ? 'в очереди' : formatDuration(bar.duration) }}</span>
      </div>

      <div class="hidden gap-3 border-t border-divider pt-1.5 sm:flex">
        <span class="w-[184px] flex-none" />
        <span class="tnum flex flex-1 justify-between font-mono text-micro text-subtle">
          <span v-for="(tick, i) in ticks" :key="i">{{ tick }}</span>
        </span>
        <span class="w-21 flex-none" />
      </div>

      <p
        v-if="heaviest"
        class="flex items-start gap-2.5 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:time-line" class="mt-0.5 shrink-0 text-warning" />
        <span>
          Шаг «{{ heaviest.name }}» занял {{ Math.round(heaviest.width) }}% времени запуска.
          Если это повторяется — смотреть в настройки ноды: число вариантов и выбранную модель.
        </span>
      </p>
    </div>
  </div>
</template>
