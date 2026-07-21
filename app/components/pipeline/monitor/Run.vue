<script setup lang="ts">
import type { WorkflowRunSummary, WorkflowStepSummary } from '~~/shared/types/workflow'
import { getRunStatus, getTrigger } from '~~/shared/utils/pipeline-status'
import { formatDurationRange, formatRelativeTime } from '~~/shared/utils/pipeline-format'
import { getNodeUnitTarget } from '~~/shared/utils/pipeline-node-routes'

const props = defineProps<{
  run: WorkflowRunSummary
  pipelineId: number
  canCancel: boolean
  /** Для активного рана — текущий шаг (прогресс). */
  activeCurrentStep?: WorkflowStepSummary | null
  /** Всего нод для прогресса "шаг X из Y". */
  totalNodes?: number
}>()

const emit = defineEmits<{
  cancelled: []
  started: []
}>()

const status = computed(() => getRunStatus(props.run.status))
const trigger = computed(() => getTrigger(props.run.triggerType))

const isActive = computed(
  () => props.run.status === 'running' || props.run.status === 'pending',
)

const cancelling = computed(() => !!props.run.cancelRequestedAt)

const showCancel = computed(
  () => props.canCancel && isActive.value && !cancelling.value,
)

const unitTarget = computed(() =>
  getNodeUnitTarget(props.activeCurrentStep?.nodeType, {
    runId: props.run.id,
    pipelineId: props.pipelineId,
  }),
)

const progressText = computed(() => {
  if (!props.activeCurrentStep) return null
  const name = props.activeCurrentStep.nodeName
  return name ? `Узел: ${name}` : null
})

const isCancelling = ref(false)
const expanded = ref(false)
const hasLoadedSteps = ref(false)

async function handleCancel(ev: Event) {
  ev.stopPropagation()
  if (isCancelling.value) return
  isCancelling.value = true
  try {
    await $fetch(
      `/api/pipelines/${props.pipelineId}/runs/${props.run.id}/cancel`,
      { method: 'POST' },
    )
    emit('cancelled')
  }
  catch {
    // silent — refresh подхватит состояние
  }
  finally {
    isCancelling.value = false
  }
}

function openRun(ev: Event) {
  ev.stopPropagation()
  navigateTo(`/pipeline/${props.pipelineId}/runs/${props.run.id}`)
}

function openUnit(ev: Event) {
  ev.stopPropagation()
  if (unitTarget.value) navigateTo(unitTarget.value.href)
}

function toggleExpanded() {
  expanded.value = !expanded.value
  if (expanded.value) hasLoadedSteps.value = true
}
</script>

<template>
  <div
    class="rounded-box border border-base-300 bg-base-100 transition-colors hover:bg-base-200"
  >
    <div
      class="flex items-center gap-2.5 px-3 py-2 cursor-pointer"
      :title="expanded ? 'Свернуть шаги' : 'Развернуть шаги'"
      @click="toggleExpanded"
    >
      <div
        class="rounded-full w-7 h-7 flex items-center justify-center shrink-0"
        :class="status.indicator"
      >
        <Icon :name="status.icon" class="text-sm" />
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="font-mono text-xs font-semibold">#{{ run.id }}</span>
          <span class="badge badge-xs" :class="status.class">
            {{ status.label }}
          </span>
          <span v-if="cancelling" class="badge badge-xs badge-warning badge-outline gap-1">
            <span class="loading loading-spinner loading-xs" />
            Отменяется...
          </span>
        </div>
        <div class="flex items-center gap-2 mt-0.5 text-[10px] text-base-content/50 flex-wrap">
          <span class="flex items-center gap-0.5">
            <Icon :name="trigger.icon" class="text-[10px]" />
            {{ trigger.label }}
          </span>
          <span>{{ run.stepsCount }} шагов</span>
          <span class="font-mono">{{ formatDurationRange(run.startedAt, run.finishedAt) }}</span>
          <span>{{ formatRelativeTime(run.createdAt) }}</span>
        </div>
        <div v-if="isActive && progressText" class="text-[11px] mt-1 text-info flex items-center gap-1 truncate">
          <Icon name="mingcute:loading-3-line" class="text-[11px] animate-spin" />
          <span class="truncate">{{ progressText }}</span>
        </div>
        <div v-else-if="run.errorMessage" class="text-[11px] mt-1 text-error/80 truncate">
          {{ run.errorMessage }}
        </div>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <button
          v-if="unitTarget"
          class="btn btn-ghost btn-xs"
          :title="`К юниту: ${unitTarget.label}`"
          @click="openUnit"
        >
          <Icon :name="unitTarget.icon" />
          <span class="hidden sm:inline">{{ unitTarget.label }}</span>
        </button>
        <button
          v-if="showCancel"
          class="btn btn-ghost btn-xs text-error"
          :disabled="isCancelling"
          title="Отменить запуск"
          @click="handleCancel"
        >
          <span v-if="isCancelling" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:stop-circle-line" />
          <span class="hidden sm:inline">Отменить</span>
        </button>
        <button
          class="btn btn-ghost btn-xs"
          title="Открыть страницу запуска"
          @click="openRun"
        >
          <Icon name="mingcute:external-link-line" />
          <span class="hidden sm:inline">Открыть</span>
        </button>
        <Icon
          :name="expanded ? 'mingcute:up-line' : 'mingcute:down-line'"
          class="text-base-content/40 text-sm ml-0.5"
        />
      </div>
    </div>

    <div v-if="expanded" class="border-t border-base-300 px-3 pb-3">
      <PipelineMonitorRunSteps
        v-if="hasLoadedSteps"
        :pipeline-id="pipelineId"
        :run-id="run.id"
        :autoload="true"
      />
    </div>
  </div>
</template>
