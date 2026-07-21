<script setup lang="ts">
import type { WorkflowRun, WorkflowStep } from '~~/shared/types/workflow'
import { getRunStatus } from '~~/shared/utils/pipeline-status'
import { formatDurationRange } from '~~/shared/utils/pipeline-format'
import { getNodeUnitTarget } from '~~/shared/utils/pipeline-node-routes'

const props = defineProps<{
  pipelineId: number
  runId: number
  /** Если true — запускается загрузка при монтировании. */
  autoload?: boolean
}>()

const steps = ref<WorkflowStep[]>([])
const pending = ref(false)
const error = ref<string | null>(null)
const loaded = ref(false)

async function load() {
  pending.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: WorkflowRun & { steps: WorkflowStep[] } }>(
      `/api/pipelines/${props.pipelineId}/runs/${props.runId}`,
    )
    steps.value = Array.isArray(res?.data?.steps) ? res.data.steps : []
    loaded.value = true
  }
  catch (e: any) {
    error.value = e?.data?.message || 'Не удалось загрузить шаги'
  }
  finally {
    pending.value = false
  }
}

function goToUnit(step: WorkflowStep, ev: Event) {
  ev.stopPropagation()
  const target = getNodeUnitTarget(step.nodeType, {
    runId: props.runId,
    pipelineId: props.pipelineId,
  })
  if (target) navigateTo(target.href)
}

function stepStatus(s: WorkflowStep) {
  return getRunStatus(s.status)
}

onMounted(() => {
  if (props.autoload) load()
})

defineExpose({ reload: load })
</script>

<template>
  <div class="pt-2">
    <div class="flex items-center justify-between gap-2 mb-2">
      <h5 class="text-[11px] uppercase tracking-wide text-base-content/60 font-semibold">
        Шаги запуска
      </h5>
      <button
        class="btn btn-ghost btn-xs"
        :disabled="pending"
        title="Обновить список шагов"
        @click.stop="load"
      >
        <span v-if="pending" class="loading loading-spinner loading-xs" />
        <Icon v-else name="mingcute:refresh-2-line" />
      </button>
    </div>

    <div v-if="pending && steps.length === 0" class="flex justify-center py-3">
      <span class="loading loading-spinner loading-sm" />
    </div>
    <div v-else-if="error" role="alert" class="alert alert-error alert-soft py-1.5">
      <Icon name="mingcute:warning-line" />
      <span class="text-[11px]">{{ error }}</span>
    </div>
    <div v-else-if="loaded && steps.length === 0" class="text-[11px] text-base-content/50 text-center py-2">
      Шагов пока нет
    </div>
    <ul v-else class="space-y-1">
      <li
        v-for="step in steps"
        :key="step.id"
        class="flex items-center gap-2 rounded-md border border-base-300 bg-base-100 px-2 py-1.5"
        :class="step.status === 'running' ? 'border-info/40 bg-info/5' : ''"
      >
        <span
          class="rounded-full w-5 h-5 flex items-center justify-center shrink-0"
          :class="stepStatus(step).indicator"
        >
          <Icon
            :name="stepStatus(step).icon"
            class="text-[10px]"
            :class="step.status === 'running' ? 'animate-pulse' : ''"
          />
        </span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-semibold truncate">{{ step.nodeName || step.nodeId }}</span>
            <span class="badge badge-xs badge-ghost font-mono">{{ step.nodeType }}</span>
            <span class="badge badge-xs" :class="stepStatus(step).class">
              {{ stepStatus(step).label }}
            </span>
          </div>
          <div class="text-[10px] text-base-content/50 font-mono mt-0.5">
            {{ formatDurationRange(step.startedAt, step.finishedAt) }}
          </div>
        </div>
        <button
          v-if="getNodeUnitTarget(step.nodeType)"
          class="btn btn-ghost btn-xs shrink-0"
          :title="`К юниту: ${getNodeUnitTarget(step.nodeType)?.label}`"
          @click.stop="goToUnit(step, $event)"
        >
          <Icon :name="getNodeUnitTarget(step.nodeType)!.icon" />
        </button>
      </li>
    </ul>
  </div>
</template>
