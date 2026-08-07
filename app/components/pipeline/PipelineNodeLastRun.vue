<script setup lang="ts">
import type { WorkflowRun, WorkflowStep } from '~/shared/types/workflow'
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

const lastStep = computed<WorkflowStep | null>(() => {
  const steps = runDetail.value?.data?.steps
  if (!steps) return null
  return steps.find(s => s.nodeId === props.nodeId) ?? null
})

const showInput = ref(false)
const showOutput = ref(false)
</script>

<template>
  <div v-if="lastStep" class="flex flex-col gap-2">
    <div class="text-micro font-semibold tracking-wider text-subtle uppercase">
      Последний запуск
    </div>

    <div class="flex items-center gap-2">
      <PipelineRunStatusBadge :status="lastStep.status" scope="step" size="xs" />
      <span class="tnum font-mono text-sm text-subtle">
        {{ formatDurationMs(lastStep.duration) }}
      </span>
    </div>

    <p
      v-if="lastStep.error"
      class="rounded-md border border-danger-border bg-danger-bg px-2 py-1.5 text-sm text-danger"
    >
      {{ lastStep.error }}
    </p>

    <div v-if="lastStep.input" class="flex flex-col gap-1">
      <UiButton variant="ghost" class="w-full justify-start" @click="showInput = !showInput">
        <Icon
          name="mingcute:arrow-right-line"
          class="transition-transform duration-(--duration-fast) ease-out"
          :class="showInput && 'rotate-90'"
        />
        Вход
      </UiButton>
      <pre v-if="showInput" class="max-h-32 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-micro">{{ formatJson(lastStep.input) }}</pre>
    </div>

    <div v-if="lastStep.output" class="flex flex-col gap-1">
      <UiButton variant="ghost" class="w-full justify-start" @click="showOutput = !showOutput">
        <Icon
          name="mingcute:arrow-right-line"
          class="transition-transform duration-(--duration-fast) ease-out"
          :class="showOutput && 'rotate-90'"
        />
        Выход
      </UiButton>
      <pre v-if="showOutput" class="max-h-32 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-micro">{{ formatJson(lastStep.output) }}</pre>
    </div>
  </div>
</template>
