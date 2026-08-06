<script setup lang="ts">
import type { WorkflowRunSummary, WorkflowStepSummary } from '~~/shared/types/workflow'
import { getNodeUnitTarget } from '~~/shared/utils/pipeline-node-routes'
import { triggerLabel } from '../PipelineRunStatusMap'
import { formatClock } from '../PipelineRunFormat'

const props = defineProps<{
  run: WorkflowRunSummary
  pipelineId: number
  canCancel: boolean
  /** Для активного запуска — шаг, который идёт прямо сейчас. */
  activeCurrentStep?: WorkflowStepSummary | null
}>()

const emit = defineEmits<{ cancelled: [] }>()

const toast = useToast()

const isActive = computed(() => props.run.status === 'running' || props.run.status === 'pending')
/** «Останавливается» — только пока запуск ещё идёт: на завершённом отменять нечего. */
const cancelling = computed(() => !!props.run.cancelRequestedAt && isActive.value)
const showCancel = computed(() => props.canCancel && isActive.value && !cancelling.value)

const unitTarget = computed(() =>
  getNodeUnitTarget(props.activeCurrentStep?.nodeType, {
    runId: props.run.id,
    pipelineId: props.pipelineId,
  }),
)

// Длительность идущего запуска считается от «сейчас», а оно берётся после
// монтирования: Date.now() в разметке расходится при гидратации.
const now = ref<number | null>(null)
onMounted(() => { now.value = Date.now() })

const isCancelling = ref(false)
const confirmCancel = ref(false)

async function handleCancel() {
  confirmCancel.value = false
  if (isCancelling.value) return
  isCancelling.value = true
  try {
    await $fetch(`/api/pipelines/${props.pipelineId}/runs/${props.run.id}/cancel`, { method: 'POST' })
    emit('cancelled')
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось остановить запуск')
  }
  finally {
    isCancelling.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2">
    <NuxtLink
      :to="`/pipeline/${pipelineId}/runs/${run.id}`"
      class="min-w-0 flex-1 no-underline"
    >
      <span class="flex flex-wrap items-center gap-2">
        <span class="font-mono text-sm text-fg">#{{ run.id }}</span>
        <PipelineRunStatusBadge :status="run.status" size="xs" />
        <span
          v-if="cancelling"
          class="inline-flex h-[18px] items-center gap-1 rounded-sm border border-warning-border bg-warning-bg px-1.5 text-micro text-warning"
        >
          <Icon name="mingcute:loading-line" class="animate-spin" />
          останавливается
        </span>
      </span>
      <span class="tnum mt-0.5 flex flex-wrap gap-x-2.5 gap-y-1 font-mono text-micro text-subtle">
        <span>{{ triggerLabel(run.triggerType) }}</span>
        <span>{{ run.stepsCount }} шагов</span>
        <PipelineMonitorLiveDuration
          :started-at="run.startedAt"
          :finished-at="run.finishedAt"
          :now="now"
        />
        <span>{{ formatClock(run.createdAt, false) }}</span>
      </span>
      <span
        v-if="isActive && activeCurrentStep?.nodeName"
        class="mt-1 flex items-center gap-1 truncate text-sm text-info"
      >
        <Icon name="mingcute:loading-line" class="shrink-0 animate-spin" />
        {{ activeCurrentStep.nodeName }}
      </span>
      <span v-else-if="run.errorMessage" class="mt-1 block truncate text-sm text-danger">
        {{ run.errorMessage }}
      </span>
    </NuxtLink>

    <div class="flex shrink-0 items-center gap-1">
      <NuxtLink v-if="unitTarget" :to="unitTarget.href">
        <UiButton variant="ghost" :title="`К юниту: ${unitTarget.label}`">
          <Icon :name="unitTarget.icon" />
          <span class="hidden sm:inline">{{ unitTarget.label }}</span>
        </UiButton>
      </NuxtLink>
      <UiButton
        v-if="showCancel"
        variant="ghost"
        :loading="isCancelling"
        title="Остановить запуск"
        @click="confirmCancel = true"
      >
        <Icon v-if="!isCancelling" name="mingcute:forbid-circle-line" class="text-danger" />
        <span class="hidden text-danger sm:inline">Остановить</span>
      </UiButton>
    </div>

    <UiModal :open="confirmCancel" size="sm" title="Остановить запуск?" @close="confirmCancel = false">
      <p class="text-sm text-muted">
        Запуск #{{ run.id }} прервётся: активные процессы остановятся, внешние
        операции отменятся где это возможно. Уже сгенерированные материалы
        сохранятся.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmCancel = false">Отмена</UiButton>
        <UiButton variant="danger" :loading="isCancelling" @click="handleCancel">Остановить</UiButton>
      </template>
    </UiModal>
  </div>
</template>
