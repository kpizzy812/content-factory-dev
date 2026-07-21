<script setup lang="ts">
import type { WorkflowRun, WorkflowStep } from '~/shared/types/workflow'
import { getRunStatus } from '~~/shared/utils/pipeline-status'
import { formatDurationMs, formatJson } from '~~/shared/utils/pipeline-format'

const props = defineProps<{
  pipelineId: number
  nodeId: string
}>()

const { data: runsData } = useFetch<{ data: WorkflowRun[] }>(
  () => `/api/pipelines/${props.pipelineId}/runs`,
  { query: { perPage: 1 } },
)

const lastRunId = computed(() => {
  const runs = runsData.value?.data ?? []
  return runs.length > 0 ? runs[0]!.id : null
})

const { data: runDetail } = useFetch<{ data: WorkflowRun }>(
  () => lastRunId.value ? `/api/pipelines/${props.pipelineId}/runs/${lastRunId.value}` : '',
  {
    watch: [lastRunId],
    immediate: false,
  },
)

watch(lastRunId, (id) => {
  if (!id) return
})

const lastStep = computed<WorkflowStep | null>(() => {
  const steps = runDetail.value?.data?.steps
  if (!steps) return null
  return steps.find(s => s.nodeId === props.nodeId) ?? null
})

const stepStatus = computed(() => lastStep.value ? getRunStatus(lastStep.value.status) : null)

const showInput = ref(false)
const showOutput = ref(false)
</script>

<template>
  <div v-if="lastStep" class="space-y-2">
    <div class="text-xs font-semibold text-base-content/50 uppercase">
      Последний запуск
    </div>

    <div class="flex items-center gap-2 text-xs">
      <span v-if="stepStatus" class="badge badge-xs" :class="stepStatus.class">
        {{ stepStatus.label }}
      </span>
      <span class="font-mono text-base-content/50">
        {{ formatDurationMs(lastStep.duration) }}
      </span>
    </div>

    <div v-if="lastStep.error" class="text-xs text-error bg-error/10 p-2 rounded-box">
      {{ lastStep.error }}
    </div>

    <div v-if="lastStep.input" class="space-y-1">
      <button class="btn btn-ghost btn-xs w-full justify-start" @click="showInput = !showInput">
        <Icon
          name="mingcute:arrow-right-line"
          class="text-xs transition-transform"
          :class="{ 'rotate-90': showInput }"
        />
        Input
      </button>
      <pre v-if="showInput" class="text-xs bg-base-300 p-2 rounded-box overflow-x-auto max-h-32">{{ formatJson(lastStep.input) }}</pre>
    </div>

    <div v-if="lastStep.output" class="space-y-1">
      <button class="btn btn-ghost btn-xs w-full justify-start" @click="showOutput = !showOutput">
        <Icon
          name="mingcute:arrow-right-line"
          class="text-xs transition-transform"
          :class="{ 'rotate-90': showOutput }"
        />
        Output
      </button>
      <pre v-if="showOutput" class="text-xs bg-base-300 p-2 rounded-box overflow-x-auto max-h-32">{{ formatJson(lastStep.output) }}</pre>
    </div>
  </div>
</template>
