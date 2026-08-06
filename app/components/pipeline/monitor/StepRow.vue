<script setup lang="ts">
/**
 * Строка шага в хронологии запуска.
 * Источник: design-preview/catalog/05-run-monitor.dc.html
 *
 * Цвет здесь значит только статус: тип ноды передаёт монохромная иконка.
 * У шагов «в очереди» высота та же, что у выполненных — при поллинге раз в
 * две секунды вёрстка не дёргается, когда шаг меняет состояние.
 */
import type { WorkflowStep } from '~~/shared/types/workflow'
import { formatMoney } from '~~/shared/utils/money'
import { pipelineNodeMeta } from '../PipelineNodeMeta'
import { stepStatusMeta } from '../PipelineRunStatusMap'

const props = defineProps<{
  step: WorkflowStep
  index: number
  expanded: boolean
  /** Сейчас — чтобы у идущего шага длительность росла вместе с поллингом. */
  now: number | null
}>()

const emit = defineEmits<{ toggle: [] }>()

const meta = computed(() => pipelineNodeMeta(props.step.nodeType))
const status = computed(() => stepStatusMeta(props.step.status))

const isPending = computed(() => props.step.status === 'pending')
const isRunning = computed(() => props.step.status === 'running')
const isFailed = computed(() => props.step.status === 'failed')

/** Одна попытка — норма, о ней в строке молчим; повтор виден сразу. */
const attempts = computed(() => {
  const max = props.step.retryPolicy?.maxRetries
  const done = props.step.attemptCount || 0
  if (done < 2) return null
  return max != null ? `${done}/${max + 1}` : String(done)
})

/**
 * Стоимость шага. Факт главнее оценки; оценка помечена «~», чтобы её не
 * приняли за списание. Прочерк значит «сумму никто не посчитал» — у блоков,
 * которые ничего не тратят, стоит честный ноль.
 */
const cost = computed(() => {
  const actual = formatMoney(props.step.costActual)
  if (actual) return { text: actual, estimated: false }
  const estimate = formatMoney(props.step.costEstimate)
  if (estimate) return { text: `~${estimate}`, estimated: true }
  return null
})

/** Подпись типа не дублирует имя блока, если оно совпадает. */
const typeLabel = computed(() =>
  (props.step.nodeName || '').trim() === meta.value.label ? null : meta.value.label,
)

/** Обводка всей строки: выделяем только то, что требует внимания. */
const frame = computed(() => {
  if (isFailed.value) return 'border-[1.5px] border-danger'
  if (isRunning.value) return 'border-[1.5px] border-info'
  if (isPending.value) return 'border border-dashed border-border opacity-70'
  return 'border border-border'
})

const headTone = computed(() => {
  if (isFailed.value) return 'bg-danger-bg'
  if (isRunning.value) return 'bg-info-bg'
  return ''
})

const numberTone = computed(() => {
  if (isFailed.value) return 'text-danger'
  if (isRunning.value) return 'text-info'
  return 'text-subtle'
})
</script>

<template>
  <div class="overflow-hidden rounded-md bg-panel" :class="frame">
    <button
      type="button"
      class="grid w-full cursor-pointer grid-cols-[24px_26px_minmax(0,1fr)_26px] items-center gap-x-2.5 gap-y-1 px-2.5 py-[7px] text-left lg:grid-cols-[24px_26px_minmax(0,1fr)_96px_84px_84px_56px_26px]"
      :class="headTone"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <span class="tnum font-mono text-micro" :class="numberTone">{{ index + 1 }}</span>
      <span class="flex justify-center">
        <Icon
          :name="meta.icon"
          class="text-[15px]"
          :class="isPending ? 'text-subtle' : isFailed || isRunning ? 'text-fg' : 'text-muted'"
        />
      </span>
      <span class="min-w-0">
        <span
          class="block truncate text-sm"
          :class="[isPending ? 'text-muted' : 'text-fg', (isFailed || isRunning) && 'font-medium']"
        >{{ step.nodeName || step.nodeId }}</span>
        <span v-if="typeLabel" class="block truncate text-micro text-subtle">{{ typeLabel }}</span>
      </span>

      <!-- До 1024 статус, длительность и попытки уходят второй строкой; на широком
           экране `contents` возвращает их в колонки сетки, как в макете. -->
      <span class="col-start-3 flex flex-wrap items-center gap-x-3 gap-y-1 lg:contents">
        <PipelineRunStatusBadge :status="step.status" scope="step" :on-tinted="isFailed || isRunning" />
        <PipelineMonitorLiveDuration
          v-if="!isPending"
          class="font-mono text-sm lg:text-right"
          :class="isFailed ? 'text-danger' : isRunning ? 'text-info' : 'text-muted'"
          :started-at="step.startedAt"
          :finished-at="step.finishedAt"
          :ms="step.duration"
          :now="now"
          empty=""
        />
        <span v-else />
        <span
          class="tnum font-mono text-sm lg:text-right"
          :class="cost?.estimated ? 'text-subtle' : 'text-muted'"
          :title="cost?.estimated ? 'Оценка до запуска' : 'Списано'"
        >{{ cost?.text ?? '' }}</span>
        <span class="tnum font-mono text-micro text-warning lg:text-right" title="Попыток">
          <template v-if="attempts">×{{ attempts }}</template>
        </span>
      </span>

      <Icon
        name="mingcute:up-line"
        class="col-start-4 row-start-1 justify-self-end text-subtle transition-transform duration-(--duration-fast) lg:col-start-8 lg:row-start-auto"
        :class="!expanded && 'rotate-180'"
      />
    </button>

    <div v-if="expanded" class="border-t border-divider px-3 py-2.5 lg:pl-[60px]">
      <slot />
    </div>
  </div>
</template>
