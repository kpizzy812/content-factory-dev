<script setup lang="ts">
/**
 * Раскрытый шаг: почему встало, что делать и какие данные прошли.
 * Источник: design-preview/catalog/05-run-monitor.dc.html
 *
 * «Пропустить и продолжить» отвечает на случай, которого повтор не закрывает:
 * некритичный блок упал и держит весь запуск, а переисполнять его бессмысленно —
 * чат удалён, метрик не будет. Повтор бесплатен только у пропуска: он ничего
 * не переисполняет, поэтому стоит в строке, а не в меню с ценой.
 */
import type { WorkflowStep } from '~~/shared/types/workflow'
import { getNodeUnitTarget } from '~~/shared/utils/pipeline-node-routes'
import { errorCategoryLabel } from '../PipelineRunStatusMap'
import { formatClock } from '../PipelineRunFormat'

const props = defineProps<{
  step: WorkflowStep
  pipelineId: string | number
  dataMode: 'readable' | 'json'
  /** Повтор доступен только на упавшем и отменённом запуске. */
  retryable: boolean
  retrying: boolean
  skipping?: boolean
  nodeLabels: Map<string, string>
}>()

const emit = defineEmits<{
  'retry': []
  'skip': []
  'logs': []
  'update:dataMode': [value: 'readable' | 'json']
}>()

const attempts = computed(() => {
  const done = props.step.attemptCount || 0
  const max = props.step.retryPolicy?.maxRetries
  if (!done) return null
  return {
    done,
    total: max != null ? max + 1 : null,
    exhausted: max != null && done >= max + 1,
  }
})

const unitTarget = computed(() => getNodeUnitTarget(props.step.nodeType, {
  runId: props.step.runId,
  pipelineId: Number(props.pipelineId),
}))

const edgeSnapshot = computed(() => {
  const out = props.step.output as Record<string, any> | null
  return out?._edgeSnapshot ?? null
})
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div v-if="step.error" class="flex flex-col gap-2">
      <p class="text-sm text-fg">{{ step.error }}</p>
      <div
        class="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-sm text-muted"
      >
        <span v-if="attempts" class="inline-flex items-center gap-1.5">
          Попытка
          <span class="tnum font-mono" :class="attempts.exhausted ? 'text-danger' : 'text-fg'">
            {{ attempts.total ? `${attempts.done} из ${attempts.total}` : attempts.done }}
          </span>
        </span>
        <span v-if="attempts?.exhausted" class="inline-flex items-center gap-1.5">
          Автоповторов<span class="text-fg">больше не будет</span>
        </span>
        <span v-if="step.errorCategory" class="inline-flex items-center gap-1.5">
          Причина<span class="font-mono text-fg">{{ errorCategoryLabel(step.errorCategory) }}</span>
        </span>
      </div>
    </div>

    <PipelineMonitorStepDiagnostics :step="step" />

    <div class="flex flex-wrap gap-1.5">
      <UiButton v-if="retryable" variant="primary" :loading="retrying" @click="emit('retry')">
        <Icon v-if="!retrying" name="mingcute:refresh-2-line" />
        Повторить с этого шага
      </UiButton>
      <UiButton v-if="retryable" :loading="skipping" @click="emit('skip')">
        <Icon v-if="!skipping" name="mingcute:skip-forward-line" />
        Пропустить и продолжить
      </UiButton>
      <UiButton variant="ghost" @click="emit('logs')">
        <Icon name="mingcute:list-check-line" />
        Логи шага
      </UiButton>
      <NuxtLink v-if="unitTarget" :to="unitTarget.href">
        <UiButton variant="ghost">
          <Icon :name="unitTarget.icon" />
          {{ unitTarget.label }}
        </UiButton>
      </NuxtLink>
      <!-- Глубокая ссылка на блок: редактор читает ?node и выделяет его. -->
      <NuxtLink :to="{ path: `/pipeline/${pipelineId}`, query: { node: step.nodeId } }">
        <UiButton variant="ghost">
          <Icon name="mingcute:edit-2-line" />
          Открыть в редакторе
        </UiButton>
      </NuxtLink>
    </div>

    <PipelineMonitorStepEdgeSnapshot
      v-if="edgeSnapshot"
      :edge-snapshot="edgeSnapshot"
      :current-node-type="step.nodeType"
      :node-labels="nodeLabels"
    />

    <PipelineMonitorStepDataViewer
      v-if="step.input"
      title="Вход"
      :data="step.input"
      :mode="dataMode"
      @update:mode="(v) => emit('update:dataMode', v)"
    />
    <PipelineMonitorStepDataViewer
      v-if="step.output"
      title="Выход"
      :data="step.output"
      :mode="dataMode"
      @update:mode="(v) => emit('update:dataMode', v)"
    />

    <div
      v-if="step.startedAt || step.finishedAt"
      class="tnum flex flex-wrap gap-4 font-mono text-micro text-subtle"
    >
      <span v-if="step.startedAt">начало {{ formatClock(step.startedAt) }}</span>
      <span v-if="step.finishedAt">конец {{ formatClock(step.finishedAt) }}</span>
    </div>
  </div>
</template>
