<script setup lang="ts">
/**
 * Шапка запуска. Источник: design-preview/catalog/05-run-monitor.dc.html
 *
 * «Остановить» осталось видимой кнопкой, а не пунктом меню: на идущем запуске
 * это главное действие раздела, и прятать его глубже, чем перезапуск, вредно.
 * Перезапуск платный и уехал в меню — цены у него нет ни в одном endpoint,
 * поэтому вместо суммы модалка объясняет, что будет пересчитано.
 */
import type { WorkflowRun, WorkflowStep } from '~~/shared/types/workflow'
import { STATUS_FILL, runStatusMeta, stepStatusMeta, triggerLabel, errorCategoryLabel } from '../PipelineRunStatusMap'

interface ActionMenuItem {
  key: string
  label: string
  icon?: string
  cost?: string
  danger?: boolean
  disabled?: boolean
  group?: string
}
import { formatClock, runAuthorLabel, runCostLabel } from '../PipelineRunFormat'
import { formatMoney } from '~~/shared/utils/money'

const props = defineProps<{
  run: WorkflowRun & {
    triggeredByUser?: { name: string | null; surname: string | null; email: string } | null
  }
  steps: WorkflowStep[]
  pipelineName: string
  pipelineId: string | number
  /** Всего блоков в графе конвейера — знаем только когда граф загружен. */
  totalNodes: number | null
  tab: 'steps' | 'gantt' | 'logs'
  logAlerts: number
  now: number | null
  updatedAt: number | null
  canCancel: boolean
  canReplay: boolean
  cancelling: boolean
  replaying: boolean
}>()

const emit = defineEmits<{
  'update:tab': [value: 'steps' | 'gantt' | 'logs']
  'cancel': []
  'replay': []
  'retryFailed': []
  'copyId': []
}>()

const status = computed(() => runStatusMeta(props.run.status))

const doneSteps = computed(() =>
  props.steps.filter(s => ['success', 'partial', 'no_data', 'skipped'].includes(s.status)).length,
)

const stepsLabel = computed(() => {
  const total = props.totalNodes && props.totalNodes >= props.steps.length ? props.totalNodes : props.steps.length
  return total ? `${doneSteps.value} из ${total}` : '—'
})

/** Полоска прогресса: по сегменту на шаг, цвет — состояние. */
const segments = computed(() =>
  props.steps.map(step => ({
    id: step.id,
    fill: STATUS_FILL[stepStatusMeta(step.status).entity],
    live: step.status === 'running',
  })),
)

const failedStep = computed(() => props.steps.find(s => s.status === 'failed') ?? null)

/**
 * Стоимость запуска: агрегат по шагам. У идущего запуска это «накоплено», а не
 * итог, поэтому подпись меняется вместе со статусом.
 */
const runCost = computed(() => runCostLabel(props.run))

/** «Д. Кузнецов, вручную» из макета. Без автора остаётся способ запуска. */
const author = computed(() => runAuthorLabel(props.run.triggeredByUser))
const costLabel = computed(() => (props.run.status === 'running' ? 'Потрачено' : 'Стоимость'))

/**
 * Цена повтора — то, во что запуск обошёлся в прошлый раз. Это оценка, а не
 * счёт: граф и провайдеры могли поменяться, поэтому «около».
 */
const replayPrice = computed(() => (runCost.value ? `около ${runCost.value}` : 'платно'))

/** Повтор с упавшего шага пересчитывает только то, что ниже по графу. */
const retryPrice = computed(() => {
  if (!failedStep.value) return 'платно'
  const from = props.steps.findIndex(s => s.id === failedStep.value!.id)
  const spentBelow = props.steps
    .slice(from)
    .reduce<number | null>((sum, step) => (step.costActual == null ? sum : (sum ?? 0) + step.costActual), null)
  const price = formatMoney(spentBelow)
  return price ? `около ${price}` : 'платно'
})

const menuItems = computed<ActionMenuItem[]>(() => {
  const items: ActionMenuItem[] = []
  if (props.canReplay) {
    items.push({
      key: 'replay',
      label: 'Повторить запуск',
      icon: 'mingcute:refresh-2-line',
      group: 'Перезапуск',
      disabled: props.replaying,
      cost: replayPrice.value,
    })
  }
  if (failedStep.value && ['failed', 'cancelled'].includes(props.run.status)) {
    items.push({
      key: 'retry-failed',
      label: 'Повторить с упавшего шага',
      icon: 'mingcute:skip-forward-line',
      group: 'Перезапуск',
      cost: retryPrice.value,
    })
  }
  items.push({ key: 'editor', label: 'Открыть в редакторе', icon: 'mingcute:edit-2-line' })
  items.push({ key: 'copy', label: 'Скопировать номер', icon: 'mingcute:copy-2-line' })
  return items
})

function onSelect(key: string) {
  if (key === 'replay') emit('replay')
  else if (key === 'retry-failed') emit('retryFailed')
  else if (key === 'copy') emit('copyId')
  else if (key === 'editor') navigateTo(`/pipeline/${props.pipelineId}`)
}

const TABS = [
  { key: 'steps', label: 'Шаги' },
  { key: 'gantt', label: 'Длительности' },
  { key: 'logs', label: 'Логи' },
] as const
</script>

<template>
  <header class="flex-none border-b border-border bg-panel px-4 py-2.5">
    <div class="flex flex-wrap items-center gap-2.5">
      <NuxtLink
        :to="`/pipeline/${pipelineId}/runs`"
        class="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm text-muted no-underline hover:bg-card hover:text-fg xl:hidden"
      >
        <Icon name="mingcute:left-line" />
        Запуски
      </NuxtLink>

      <h1 class="min-w-0 flex-1 truncate text-lg font-semibold">{{ pipelineName }}</h1>

      <span
        class="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-sm border border-border bg-card px-2 font-mono text-sm text-muted"
      >#{{ run.id }}</span>

      <PipelineRunStatusBadge :status="run.status" size="md" />

      <span
        v-if="run.errorCategory"
        class="inline-flex h-[22px] shrink-0 items-center rounded-sm border border-danger-border bg-danger-bg px-2 text-sm text-danger"
      >{{ errorCategoryLabel(run.errorCategory) }}</span>

      <div class="flex shrink-0 items-center gap-1.5">
        <UiButton v-if="canCancel" variant="danger" :loading="cancelling" @click="emit('cancel')">
          <Icon v-if="!cancelling" name="mingcute:forbid-circle-line" />
          Остановить
        </UiButton>
        <UiActionMenu :items="menuItems" @select="onSelect" />
      </div>
    </div>

    <div v-if="segments.length" class="mt-2 flex gap-[3px]">
      <span
        v-for="segment in segments"
        :key="segment.id"
        class="h-1 flex-1 overflow-hidden rounded-[2px]"
        :class="[segment.fill, segment.live && 'motion-safe:animate-pulse']"
      />
    </div>

    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
      <span class="inline-flex items-center gap-1.5">
        Старт<span class="tnum font-mono text-fg">{{ formatClock(run.startedAt) }}</span>
      </span>
      <span class="inline-flex items-center gap-1.5">
        Длительность
        <PipelineMonitorLiveDuration
          class="font-mono text-fg"
          :started-at="run.startedAt"
          :finished-at="run.finishedAt"
          :now="now"
        />
      </span>
      <span class="inline-flex items-center gap-1.5">
        Шагов<span class="tnum font-mono text-fg">{{ stepsLabel }}</span>
      </span>
      <span v-if="runCost" class="inline-flex items-center gap-1.5">
        {{ costLabel }}<span class="tnum font-mono text-fg">{{ runCost }}</span>
      </span>
      <span class="inline-flex items-center gap-1.5">
        Запуск<span class="text-fg">{{ author ? `${author}, ${triggerLabel(run.triggerType)}` : triggerLabel(run.triggerType) }}</span>
      </span>
      <NuxtLink
        v-if="run.replayOfRunId"
        :to="`/pipeline/${pipelineId}/runs/${run.replayOfRunId}`"
        class="inline-flex items-center gap-1.5 text-sm"
      >
        повтор запуска #{{ run.replayOfRunId }}
      </NuxtLink>
      <span class="flex-1" />
      <ClientOnly>
        <span v-if="updatedAt" class="inline-flex items-center gap-1.5 text-micro text-subtle">
          <span class="size-1.5 rounded-full" :class="STATUS_FILL[status.entity]" />
          обновлено {{ formatClock(new Date(updatedAt).toISOString()) }}
        </span>
      </ClientOnly>
    </div>

    <div class="mt-2.5 flex gap-0.5">
      <button
        v-for="item in TABS"
        :key="item.key"
        type="button"
        class="h-7 cursor-pointer border-b-2 px-2.5 text-sm"
        :class="tab === item.key
          ? 'border-accent font-medium text-fg'
          : 'border-transparent text-muted hover:text-fg'"
        @click="emit('update:tab', item.key)"
      >
        {{ item.label }}
        <span v-if="item.key === 'logs' && logAlerts" class="tnum ml-1.5 font-mono text-micro text-warning">
          {{ logAlerts }}
        </span>
      </button>
    </div>
  </header>
</template>
