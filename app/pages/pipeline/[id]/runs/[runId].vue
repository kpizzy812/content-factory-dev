<script setup lang="ts">
import { getRunStatus, getTrigger, getErrorCategoryLabel } from '~~/shared/utils/pipeline-status'
import { formatDurationMs, formatDateShort } from '~~/shared/utils/pipeline-format'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'pipeline' })

const monitorStore = usePipelineMonitorStore()

// localStorage-настройки (dataFormat) читаем строго после монтирования, чтобы
// SSR и первый клиентский рендер были идентичны.
onMounted(() => {
  monitorStore.hydrateFromStorage()
})

const route = useRoute()
const pipelineId = computed(() => route.params.id as string)
const runId = computed(() => route.params.runId as string)

const { data, pending, error, isActive, refresh } = usePipelineRunDetail(pipelineId, runId)

const run = computed(() => data.value?.data ?? null)
const steps = computed(() => run.value?.steps ?? [])

useHead({ title: computed(() => run.value ? `Запуск #${run.value.id}` : 'Запуск') })

const expandedSteps = ref<Set<number>>(new Set())

function toggleStep(stepId: number) {
  if (expandedSteps.value.has(stepId)) {
    expandedSteps.value.delete(stepId)
  } else {
    expandedSteps.value.add(stepId)
  }
}

function formatDate(date: string | null): string {
  if (!date) return '--'
  return formatDateShort(date)
}

// Actions
const isCancelling = ref(false)
const isReplaying = ref(false)
const retryingStepNodeId = ref<string | null>(null)
const retryNotice = ref<{ nodeId: string; downstream: number } | null>(null)

async function cancelRun() {
  if (!run.value || !confirm('Отменить выполнение?')) return
  isCancelling.value = true
  try {
    await $fetch(`/api/pipelines/${pipelineId.value}/runs/${runId.value}/cancel`, { method: 'POST' })
    await refresh()
  } catch {
    // Error handling
  } finally {
    isCancelling.value = false
  }
}

async function replayRun() {
  if (!run.value) return
  isReplaying.value = true
  try {
    const res = await $fetch<{ data: { runId: number } }>(
      `/api/pipelines/${pipelineId.value}/runs/${runId.value}/replay`,
      { method: 'POST' },
    )
    if (res?.data?.runId) {
      await navigateTo(`/pipeline/${pipelineId.value}/runs/${res.data.runId}`)
    }
  } catch (e: any) {
    alert(e?.data?.message || 'Ошибка при перезапуске')
  } finally {
    isReplaying.value = false
  }
}

const canCancel = computed(() =>
  run.value && ['running', 'pending'].includes(run.value.status) && !run.value.cancelRequestedAt,
)

const canReplay = computed(() =>
  run.value && ['success', 'failed', 'cancelled', 'no_data'].includes(run.value.status),
)

// Retry конкретного шага доступен только если сам run завершился неуспешно
// и шаг — failed/cancelled. Engine при resume пропустит upstream success
// и пере-выполнит target+downstream.
const canRetrySteps = computed(() =>
  run.value && ['failed', 'cancelled'].includes(run.value.status),
)

function isStepRetryable(step: any): boolean {
  if (!canRetrySteps.value) return false
  return ['failed', 'cancelled'].includes(step?.status)
}

async function retryStep(step: any) {
  if (!run.value || !step?.nodeId) return
  const label = step.nodeName || step.nodeId
  if (!confirm(`Перезапустить с шага «${label}»? Все downstream шаги будут переисполнены, upstream success-шаги переиспользованы из кэша.`)) return
  retryingStepNodeId.value = step.nodeId
  try {
    const res = await $fetch<{ data: { runId: number; retriedNodeId: string; downstreamReset: string[] } }>(
      `/api/pipelines/${pipelineId.value}/runs/${runId.value}/retry-step`,
      { method: 'POST', body: { nodeId: step.nodeId } },
    )
    retryNotice.value = {
      nodeId: res.data.retriedNodeId,
      downstream: res.data.downstreamReset.length,
    }
    await refresh()
  } catch (e: any) {
    alert(e?.data?.message || 'Ошибка при перезапуске шага')
  } finally {
    retryingStepNodeId.value = null
  }
}

// Карта nodeId→label для StepEdgeSnapshot — резолвит ID upstream'ов
// в человекочитаемые имена («loop-1» → «Перебор трендов»).
const nodeLabelMap = computed(() => {
  const m = new Map<string, string>()
  for (const s of steps.value as any[]) {
    if (s?.nodeId) m.set(s.nodeId, s.nodeName || s.nodeId)
  }
  return m
})

// Stats
const stepStats = computed(() => {
  const s = steps.value
  return {
    total: s.length,
    success: s.filter((x: any) => x.status === 'success').length,
    partial: s.filter((x: any) => x.status === 'partial').length,
    failed: s.filter((x: any) => x.status === 'failed').length,
    skipped: s.filter((x: any) => x.status === 'skipped').length,
    cancelled: s.filter((x: any) => x.status === 'cancelled').length,
  }
})

// ── Fan-out cardinality: reconstruct entity flow from step outputs ──
const cardinalityFlow = computed(() => {
  const s = steps.value
  const flow: Array<{ label: string; count: number; icon: string; type: string; limited?: boolean; limitApplied?: number; totalAvailable?: number; duplicatesSkipped?: number }> = []

  for (const step of s) {
    const out = (step as any).output
    if (!out) continue
    const nodeType = (step as any).nodeType

    if (nodeType === 'trendwatcher' && Array.isArray(out.trends)) {
      flow.push({ label: 'Трендов', count: out.trends.length, icon: 'mingcute:trending-up-line', type: 'trendwatcher' })
    }

    if (nodeType === 'scenario' && out.scenariosCreated !== undefined) {
      const entry: typeof flow[0] = {
        label: 'Сценариев',
        count: (out.scenariosCreated ?? 0) + (out.skippedDuplicates ?? 0),
        icon: 'mingcute:document-line',
        type: 'scenario',
      }
      if (out._cardinalityLimited) {
        entry.limited = true
        entry.limitApplied = out._limitApplied
        entry.totalAvailable = out._totalAvailable
      }
      if (out.skippedDuplicates > 0) {
        entry.duplicatesSkipped = out.skippedDuplicates
      }
      flow.push(entry)
      if (out.variantsCreated > 0) {
        flow.push({ label: 'Вариантов', count: out.variantsCreated, icon: 'mingcute:copy-2-line', type: 'variant' })
      }
    } else if (nodeType === 'scenario' && Array.isArray(out.scenarios)) {
      flow.push({ label: 'Сценариев', count: out.scenarios.length, icon: 'mingcute:document-line', type: 'scenario' })
    }

    if (nodeType === 'video' && out.generatedCount !== undefined) {
      const entry: typeof flow[0] = {
        label: 'Видео',
        count: out.generatedCount ?? 0,
        icon: 'mingcute:video-line',
        type: 'video',
      }
      if (out._cardinalityLimited) {
        entry.limited = true
        entry.limitApplied = out._limitApplied
        entry.totalAvailable = out._totalAvailable
      }
      if (out.skippedDuplicates > 0) {
        entry.duplicatesSkipped = out.skippedDuplicates
      }
      flow.push(entry)
    }

    if (nodeType === 'upload' && out.uploadsInitiated !== undefined) {
      flow.push({ label: 'Загрузок', count: out.uploadsInitiated ?? 0, icon: 'mingcute:upload-2-line', type: 'upload' })
    }

    if (nodeType === 'idea' && out.count !== undefined) {
      flow.push({ label: 'Идей', count: out.count, icon: 'mingcute:bulb-line', type: 'idea' })
    }
  }

  return flow
})
</script>

<template>
  <div class="p-4 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center gap-2">
      <div class="tooltip tooltip-bottom" data-tip="Назад к списку запусков">
        <button class="btn btn-ghost btn-sm btn-square" @click="navigateTo(`/pipeline/${pipelineId}/runs`)">
          <Icon name="mingcute:arrow-left-line" />
        </button>
      </div>
      <h1 class="text-xl font-bold">
        Запуск #{{ runId }}
      </h1>
      <span v-if="isActive" class="loading loading-dots loading-sm text-info" />
      <div class="flex-1" />

      <!-- Формат отображения input/output шагов -->
      <div class="tooltip tooltip-bottom" data-tip="Формат отображения Input/Output в шагах">
        <div class="join">
          <button
            class="btn btn-xs join-item"
            :class="monitorStore.dataFormat === 'readable' ? 'btn-primary' : 'btn-ghost'"
            @click="monitorStore.dataFormat = 'readable'"
          >
            <Icon name="mingcute:translate-2-line" class="text-xs" />
            Читаемый
          </button>
          <button
            class="btn btn-xs join-item"
            :class="monitorStore.dataFormat === 'json' ? 'btn-primary' : 'btn-ghost'"
            @click="monitorStore.dataFormat = 'json'"
          >
            <Icon name="mingcute:code-line" class="text-xs" />
            JSON
          </button>
        </div>
      </div>

      <!-- Actions -->
      <div v-if="canCancel" class="tooltip tooltip-bottom" data-tip="Остановить выполнение этого запуска">
        <button
          class="btn btn-sm btn-warning btn-outline"
          :disabled="isCancelling"
          @click="cancelRun"
        >
          <span v-if="isCancelling" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:close-circle-line" />
          Остановить
        </button>
      </div>

      <div v-if="canReplay" class="tooltip tooltip-bottom" data-tip="Запустить конвейер заново с теми же параметрами">
        <button
          class="btn btn-sm btn-primary btn-outline"
          :disabled="isReplaying"
          @click="replayRun"
        >
          <span v-if="isReplaying" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-2-line" />
          Перезапустить
        </button>
      </div>
    </div>

    <div v-if="pending && !run" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>{{ error.message }}</span>
    </div>

    <template v-else-if="run">
      <!-- Run info card -->
      <div class="card card-border bg-base-100">
        <div class="card-body p-4 gap-3">
          <div class="flex flex-wrap gap-4 text-sm">
            <div>
              <span class="text-base-content/50">Статус:</span>
              <span class="badge badge-sm ml-1" :class="getRunStatus(run.status).class">
                <Icon :name="getRunStatus(run.status).icon" class="text-xs" />
                {{ getRunStatus(run.status).label }}
              </span>
            </div>
            <div>
              <span class="text-base-content/50">Тип:</span>
              <span class="ml-1">{{ getTrigger(run.triggerType).label }}</span>
            </div>
            <div v-if="run.errorCategory">
              <span class="text-base-content/50">Категория ошибки:</span>
              <span class="badge badge-xs badge-error ml-1">{{ getErrorCategoryLabel(run.errorCategory) }}</span>
            </div>
            <div>
              <span class="text-base-content/50">Начало:</span>
              <span class="ml-1 font-mono text-xs">{{ formatDate(run.startedAt) }}</span>
            </div>
            <div v-if="run.finishedAt">
              <span class="text-base-content/50">Конец:</span>
              <span class="ml-1 font-mono text-xs">{{ formatDate(run.finishedAt) }}</span>
            </div>
            <div v-if="run.replayOfRunId">
              <span class="text-base-content/50">Перезапуск:</span>
              <NuxtLink
                :to="`/pipeline/${pipelineId}/runs/${run.replayOfRunId}`"
                class="link link-primary text-xs ml-1"
              >
                #{{ run.replayOfRunId }}
              </NuxtLink>
            </div>
          </div>

          <!-- Step stats -->
          <div v-if="stepStats.total > 0" class="flex gap-3 text-xs">
            <span>Шагов: {{ stepStats.total }}</span>
            <span class="text-success" v-if="stepStats.success">{{ stepStats.success }} успешно</span>
            <span class="text-warning" v-if="stepStats.partial">{{ stepStats.partial }} частично</span>
            <span class="text-error" v-if="stepStats.failed">{{ stepStats.failed }} с ошибкой</span>
            <span class="text-base-content/40" v-if="stepStats.skipped">{{ stepStats.skipped }} пропущено</span>
            <span class="text-base-content/40" v-if="stepStats.cancelled">{{ stepStats.cancelled }} отменено</span>
          </div>

          <!-- Fan-out cardinality flow -->
          <div v-if="cardinalityFlow.length > 0" class="flex items-center gap-1 flex-wrap text-xs">
            <template v-for="(item, idx) in cardinalityFlow" :key="item.type + idx">
              <Icon v-if="idx > 0" name="mingcute:arrow-right-line" class="text-base-content/20 text-[10px]" />
              <div class="flex items-center gap-1 bg-base-200 rounded-btn px-2 py-1">
                <Icon :name="item.icon" class="text-xs" />
                <span class="font-bold">{{ item.count }}</span>
                <span class="text-base-content/60">{{ item.label }}</span>
                <span
                  v-if="item.limited"
                  class="badge badge-xs badge-warning"
                  :title="`Лимит: ${item.limitApplied} из ${item.totalAvailable} доступных`"
                >
                  лимит {{ item.limitApplied }}
                </span>
                <span
                  v-if="item.duplicatesSkipped"
                  class="badge badge-xs badge-ghost"
                  :title="`${item.duplicatesSkipped} пропущено (уже существовали при retry)`"
                >
                  {{ item.duplicatesSkipped }} dedup
                </span>
              </div>
            </template>
          </div>

          <!-- No-data notice -->
          <div v-if="run.status === 'no_data'" class="alert alert-warning alert-soft text-sm">
            <Icon name="mingcute:inbox-line" />
            <div>
              <p class="font-semibold">Запуск завершён без данных</p>
              <p class="text-xs opacity-80">
                Конвейер отработал технически корректно, но источник данных не вернул полезного контента.
                Это не ошибка — но и не полноценный успех.
              </p>
            </div>
          </div>

          <!-- Cancellation notice — truthful lifecycle display -->
          <div v-if="run.cancelRequestedAt && run.status === 'running'" class="alert alert-warning text-sm">
            <span class="loading loading-spinner loading-xs" />
            <div>
              <p class="font-semibold">Отмена в процессе...</p>
              <p class="text-xs opacity-80">
                Запрошена {{ formatDate(run.cancelRequestedAt) }}. Идёт остановка активных процессов и внешних операций.
              </p>
            </div>
          </div>
          <div v-else-if="run.cancelRequestedAt && run.status === 'cancelled'" class="alert alert-neutral alert-soft text-sm">
            <Icon name="mingcute:close-circle-line" />
            <div>
              <p class="font-semibold">Выполнение остановлено</p>
              <p class="text-xs opacity-80">
                Отмена запрошена {{ formatDate(run.cancelRequestedAt) }}.
                Все активные процессы прерваны, внешние операции отменены где это было возможно.
              </p>
            </div>
          </div>

          <div v-if="run.errorMessage" role="alert" class="alert text-sm" :class="run.status === 'no_data' ? 'alert-warning alert-soft' : 'alert-error alert-soft'">
            {{ run.errorMessage }}
          </div>
        </div>
      </div>

      <!-- Retry-step success notice -->
      <div v-if="retryNotice" role="alert" class="alert alert-info alert-soft">
        <Icon name="mingcute:refresh-2-line" />
        <div class="text-sm">
          <p class="font-semibold">Запуск возобновлён с шага {{ retryNotice.nodeId }}</p>
          <p class="text-xs opacity-80">
            Сброшено downstream-шагов: {{ retryNotice.downstream }}.
            Upstream success-шаги будут переиспользованы из кэша.
          </p>
        </div>
        <button class="btn btn-ghost btn-xs btn-square" @click="retryNotice = null">
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <!-- Steps timeline -->
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th class="w-8" />
              <th>Блок</th>
              <th>Тип</th>
              <th>Статус</th>
              <th>Попытки</th>
              <th>Время</th>
              <th class="w-10" />
            </tr>
          </thead>
          <tbody>
            <template v-for="step in steps" :key="step.id">
              <tr
                class="hover:bg-base-200 cursor-pointer"
                @click="toggleStep(step.id)"
              >
                <td>
                  <Icon
                    name="mingcute:arrow-right-line"
                    class="text-xs transition-transform duration-200"
                    :class="{ 'rotate-90': expandedSteps.has(step.id) }"
                  />
                </td>
                <td class="font-medium text-sm">
                  {{ step.nodeName }}
                  <!-- Inline cardinality hint -->
                  <span v-if="step.output?.trendsReceived > 0" class="text-[10px] text-base-content/40 ml-1">
                    {{ step.output.trendsProcessed }}/{{ step.output.trendsReceived }} трендов
                  </span>
                  <span v-if="step.output?.scenariosReceived > 0" class="text-[10px] text-base-content/40 ml-1">
                    {{ step.output.scenariosProcessed }}/{{ step.output.scenariosReceived }} сценариев
                  </span>
                  <span v-if="step.output?._cardinalityLimited" class="badge badge-xs badge-warning ml-1">
                    лимит
                  </span>
                  <span v-if="step.output?.skippedDuplicates > 0" class="badge badge-xs badge-ghost ml-1">
                    {{ step.output.skippedDuplicates }} dedup
                  </span>
                </td>
                <td class="text-xs text-base-content/60">{{ step.nodeType }}</td>
                <td>
                  <span class="badge badge-sm" :class="getRunStatus(step.status).class">
                    <Icon :name="getRunStatus(step.status).icon" class="text-xs" />
                    {{ getRunStatus(step.status).label }}
                  </span>
                </td>
                <td class="text-xs font-mono">{{ step.attemptCount || 1 }}</td>
                <td class="text-xs font-mono">{{ formatDurationMs(step.duration) }}</td>
                <td class="text-right" @click.stop>
                  <div
                    v-if="isStepRetryable(step)"
                    class="tooltip tooltip-left"
                    data-tip="Перезапустить с этого шага. Upstream success-шаги переиспользуются, downstream — переисполняются."
                  >
                    <button
                      class="btn btn-xs btn-ghost btn-square"
                      :disabled="retryingStepNodeId !== null"
                      @click="retryStep(step)"
                    >
                      <span v-if="retryingStepNodeId === step.nodeId" class="loading loading-spinner loading-xs" />
                      <Icon v-else name="mingcute:refresh-2-line" class="text-xs" />
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="expandedSteps.has(step.id)">
                <td colspan="7" class="bg-base-200/50 p-3">
                  <div class="space-y-2 text-xs">
                    <!-- Error with category -->
                    <div v-if="step.error" class="rounded-box border border-error/30 bg-error/5 p-2">
                      <div class="flex items-center gap-1 text-error font-semibold mb-1">
                        <Icon name="mingcute:close-circle-line" class="text-xs" />
                        Ошибка
                        <span v-if="step.errorCategory" class="badge badge-xs badge-error ml-1">{{ getErrorCategoryLabel(step.errorCategory) }}</span>
                      </div>
                      <p class="text-error/80 break-words">{{ step.error }}</p>
                    </div>

                    <!-- No-data explanation -->
                    <div v-if="step.status === 'no_data' || step.output?._noData" class="rounded-box border border-warning/30 bg-warning/5 p-2">
                      <div class="flex items-center gap-1 text-warning font-semibold mb-1">
                        <Icon name="mingcute:inbox-line" class="text-xs" />
                        Нет данных
                      </div>
                      <p class="text-warning/90 break-words">
                        {{ step.output?._noDataReason || step.output?.reason || 'Нода технически отработала, но не произвела полезного результата' }}
                      </p>
                      <div v-if="step.output?.skipped" class="text-[10px] text-base-content/50 mt-1">
                        Downstream-ноды пропущены через propagation
                      </div>
                    </div>

                    <!-- Notification skipped (no_data policy) -->
                    <div v-if="step.nodeType === 'notification' && step.output?.skipReason === 'no_data'" class="rounded-box border border-info/30 bg-info/5 p-2">
                      <div class="flex items-center gap-1 text-info font-semibold mb-1">
                        <Icon name="mingcute:notification-off-line" class="text-xs" />
                        Уведомление не отправлено
                      </div>
                      <p class="text-info/80 break-words">
                        Сработала политика «Пропускать при отсутствии данных» — ложно-успешное сообщение не ушло.
                      </p>
                      <div v-if="step.output?.noDataSources?.length" class="text-[10px] text-base-content/60 mt-1">
                        Источники без данных:
                        <span
                          v-for="(src, i) in step.output.noDataSources"
                          :key="i"
                          class="badge badge-xs badge-ghost ml-0.5"
                        >{{ src.nodeName }}</span>
                      </div>
                    </div>

                    <!-- Step logs -->
                    <div v-if="step.logs && step.logs.length > 0">
                      <div class="font-semibold mb-1 text-base-content/70">Логи:</div>
                      <div class="space-y-0.5 max-h-32 overflow-y-auto bg-base-300 rounded-box p-2">
                        <div
                          v-for="(log, li) in step.logs"
                          :key="li"
                          class="flex gap-2 text-[10px]"
                          :class="{
                            'text-error': log.level === 'error',
                            'text-warning': log.level === 'warn',
                            'text-base-content/60': log.level === 'info',
                            'text-base-content/40': log.level === 'debug',
                          }"
                        >
                          <span class="font-mono text-base-content/30 shrink-0">
                            {{ new Date(log.ts).toLocaleTimeString('ru-RU') }}
                          </span>
                          <span>{{ log.message }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Model access error diagnostic (video step) -->
                    <div
                      v-if="step.nodeType === 'video' && step.error && (step.error.includes('Нет доступа') || step.error.includes('blocked_by_access') || step.error.includes('403'))"
                      class="rounded-box border border-error/30 bg-error/5 p-3 space-y-1"
                    >
                      <div class="flex items-center gap-1 text-error font-semibold text-xs">
                        <Icon name="mingcute:forbid-circle-line" class="text-sm" />
                        Проблема доступа к модели fal.ai
                      </div>
                      <p class="text-error/80 text-[10px] break-words">{{ step.error }}</p>
                      <div class="text-[10px] text-base-content/50 mt-1">
                        Вероятная причина: API-ключ (FAL_KEY) не имеет прав на выбранную модель.
                        Проверьте план/workspace аккаунта fal.ai или выберите другую модель в настройках блока Видео.
                      </div>
                    </div>

                    <!-- Domain outcome summary for video steps -->
                    <div v-if="step.nodeType === 'video' && (step.output?.generatedCount !== undefined || step.output?.failedCount !== undefined)" class="space-y-2">
                      <!-- Domain status badge -->
                      <div v-if="step.output?._domainStatus" class="flex items-center gap-2">
                        <span class="badge badge-sm" :class="{
                          'badge-success': step.output._domainStatus === 'success',
                          'badge-warning': step.output._domainStatus === 'partial',
                          'badge-error': step.output._domainStatus === 'failed',
                        }">
                          {{ step.output._domainStatus === 'success' ? 'Все видео готовы' : step.output._domainStatus === 'partial' ? 'Частичный результат' : 'Генерация не удалась' }}
                        </span>
                        <span v-if="step.output._domainDegraded" class="text-[10px] text-warning">
                          (есть ошибки, но часть видео готова)
                        </span>
                      </div>
                      <div class="flex gap-2">
                        <div class="stat bg-base-300 rounded-box p-2 flex-1">
                          <div class="stat-title text-[10px]">Сгенерировано</div>
                          <div class="stat-value text-sm text-success">{{ step.output?.generatedCount ?? 0 }}</div>
                        </div>
                        <div class="stat bg-base-300 rounded-box p-2 flex-1">
                          <div class="stat-title text-[10px]">Ошибки</div>
                          <div class="stat-value text-sm" :class="step.output?.failedCount > 0 ? 'text-error' : 'text-base-content/40'">{{ step.output?.failedCount ?? 0 }}</div>
                        </div>
                        <div v-if="step.output?.timeoutCount > 0" class="stat bg-base-300 rounded-box p-2 flex-1">
                          <div class="stat-title text-[10px]">Таймауты</div>
                          <div class="stat-value text-sm text-warning">{{ step.output.timeoutCount }}</div>
                        </div>
                      </div>
                      <div v-if="step.output?.timeoutCount > 0" class="alert alert-warning alert-soft text-xs py-1.5">
                        <Icon name="mingcute:time-line" />
                        <span>Remote job может ещё выполняться на fal.ai. Используйте Resume для переподключения к результату.</span>
                      </div>

                      <!-- Cost tracking: estimate vs actual -->
                      <div v-if="step.output?.videos?.some((v: any) => v.totalCostEstimate != null || v.totalCostActual != null)" class="space-y-1">
                        <div class="font-semibold text-base-content/70 text-[10px]">Стоимость:</div>
                        <div v-for="(v, vi) in step.output.videos" :key="'cost-' + vi" class="flex items-center gap-3 text-[10px]">
                          <span class="font-mono">ID: {{ v.id }}</span>
                          <span v-if="v.totalCostEstimate != null" class="text-base-content/60">
                            Оценка: ${{ Number(v.totalCostEstimate).toFixed(2) }}
                          </span>
                          <span v-if="v.totalCostActual != null" class="text-success">
                            Факт: ${{ Number(v.totalCostActual).toFixed(2) }}
                          </span>
                          <span v-if="v.totalCostEstimate != null && v.totalCostActual != null" class="text-base-content/40">
                            ({{ v.totalCostActual > v.totalCostEstimate ? '+' : '' }}{{ ((v.totalCostActual - v.totalCostEstimate) / v.totalCostEstimate * 100).toFixed(0) }}%)
                          </span>
                          <span v-if="v.totalCostActual == null && v.status === 'completed'" class="text-warning text-[9px]">
                            actual cost отсутствует
                          </span>
                        </div>
                      </div>

                      <!-- Effective models used -->
                      <div v-if="step.output?.videos?.some((v: any) => v.imageModelId || v.videoModelId)" class="text-[10px] text-base-content/60">
                        <span class="font-semibold text-base-content/70">Модели: </span>
                        <template v-for="(v, vi) in step.output.videos.slice(0, 1)" :key="'model-' + vi">
                          <span v-if="v.imageModelId" class="badge badge-xs badge-ghost mr-1">{{ v.imageModelId }}</span>
                          <span v-if="v.videoModelId" class="badge badge-xs badge-ghost mr-1">{{ v.videoModelId }}</span>
                          <span v-if="v.generateAudio === false" class="badge badge-xs badge-warning mr-1">audio: off</span>
                        </template>
                      </div>
                    </div>

                    <!-- Notification render status -->
                    <div v-if="step.nodeType === 'notification' && step.output?.renderStatus" class="text-xs">
                      <div v-if="step.output.renderStatus === 'blocked_unresolved_variables'" class="alert alert-error alert-soft py-1.5">
                        <Icon name="mingcute:close-circle-line" />
                        <div>
                          <p class="font-semibold">Отправка заблокирована: неразрешённые переменные</p>
                          <p v-if="step.output?.error">{{ step.output.error }}</p>
                        </div>
                      </div>
                      <div v-else-if="step.output.renderStatus === 'blocked_template_error'" class="alert alert-error alert-soft py-1.5">
                        <Icon name="mingcute:close-circle-line" />
                        <div>
                          <p class="font-semibold">Отправка заблокирована: ошибка шаблона</p>
                          <p v-if="step.output?.error">{{ step.output.error }}</p>
                        </div>
                      </div>
                      <div v-else-if="step.output.renderStatus === 'sent_degraded'" class="alert alert-warning alert-soft py-1.5">
                        <Icon name="mingcute:warning-line" />
                        <span class="font-semibold">Отправлено с неразрешёнными переменными (degraded)</span>
                      </div>
                      <div v-else-if="step.output.renderStatus === 'rendered_ok'" class="alert alert-success alert-soft py-1.5">
                        <Icon name="mingcute:check-circle-line" />
                        <span>Отправлено успешно</span>
                      </div>
                    </div>
                    <!-- Legacy: notification without renderStatus -->
                    <div v-else-if="step.nodeType === 'notification' && step.output?.sent === false" class="alert alert-error alert-soft text-xs py-1.5">
                      <Icon name="mingcute:close-circle-line" />
                      <div>
                        <p class="font-semibold">Уведомление не отправлено</p>
                        <p v-if="step.output?.error">{{ step.output.error }}</p>
                      </div>
                    </div>

                    <!-- Generation errors (partial failures) -->
                    <div v-if="step.output?.errors?.length" class="alert alert-warning alert-soft text-xs py-1.5">
                      <Icon name="mingcute:warning-line" />
                      <div>
                        <div v-for="(err, i) in step.output.errors" :key="i">{{ err }}</div>
                      </div>
                    </div>

                    <!-- Notification variable details -->
                    <div v-if="step.output?.unresolvedVariables?.length" class="alert alert-warning alert-soft text-xs py-1.5">
                      <Icon name="mingcute:warning-line" />
                      <div>
                        <p class="font-semibold">Неразрешённые переменные</p>
                        <p>{{ step.output.unresolvedVariables.join(', ') }}</p>
                      </div>
                    </div>
                    <div v-if="step.output?.strippedExpressions?.length" class="alert alert-info alert-soft text-xs py-1.5">
                      <Icon name="mingcute:information-line" />
                      <div>
                        <p class="font-semibold">Удалены неподдерживаемые выражения</p>
                        <div v-for="(expr, i) in step.output.strippedExpressions" :key="i" class="font-mono text-[10px]">{{ expr }}</div>
                      </div>
                    </div>
                    <div v-if="step.output?.resolvedVariables?.length" class="text-[10px] text-base-content/50">
                      Подставлены: {{ step.output.resolvedVariables.join(', ') }}
                    </div>
                    <div v-if="step.output?.resolvedSnapshot && Object.keys(step.output.resolvedSnapshot).length" class="text-[10px]">
                      <div class="font-semibold text-base-content/70 mb-0.5">Snapshot переменных:</div>
                      <div class="bg-base-300 rounded-box p-1.5 space-y-0.5">
                        <div v-for="(val, key) in step.output.resolvedSnapshot" :key="key" class="flex gap-1">
                          <span class="font-mono text-base-content/50">{{ key }}:</span>
                          <span>{{ val }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- fal.ai job details for video steps -->
                    <div v-if="step.nodeType === 'video' && step.output?.videos?.length" class="space-y-1">
                      <div class="font-semibold mb-1 text-base-content/70">Статус видео:</div>
                      <div v-for="(v, vi) in step.output.videos" :key="vi" class="flex items-center gap-2 bg-base-300 rounded-box p-2 text-[10px]">
                        <span class="badge badge-xs" :class="{
                          'badge-success': v.status === 'completed',
                          'badge-error': v.status === 'failed',
                          'badge-warning': v.status === 'timeout',
                          'badge-info': !['completed', 'failed', 'timeout'].includes(v.status),
                        }">
                          {{ v.status === 'timeout' ? 'таймаут' : v.status }}
                        </span>
                        <span class="font-mono">ID: {{ v.id }}</span>
                        <span v-if="v.errorMessage" class="text-error truncate max-w-xs">{{ v.errorMessage }}</span>
                        <span v-if="v.duration" class="text-base-content/40">{{ v.duration }}s</span>
                        <span v-if="v.totalCostActual != null" class="text-success">${{ Number(v.totalCostActual).toFixed(2) }}</span>
                        <span v-else-if="v.totalCostEstimate != null" class="text-base-content/40">~${{ Number(v.totalCostEstimate).toFixed(2) }}</span>
                      </div>
                    </div>

                    <PipelineMonitorStepDataViewer
                      v-if="step.input"
                      title="Входные данные"
                      :data="step.input"
                      :mode="monitorStore.dataFormat"
                    />
                    <PipelineMonitorStepEdgeSnapshot
                      v-if="step.output && (step.output as any)._edgeSnapshot"
                      :edge-snapshot="(step.output as any)._edgeSnapshot"
                      :current-node-type="step.nodeType"
                      :node-labels="nodeLabelMap"
                    />
                    <PipelineMonitorStepDataViewer
                      v-if="step.output"
                      title="Результат"
                      :data="step.output"
                      :mode="monitorStore.dataFormat"
                    />

                    <!-- Timestamps -->
                    <div v-if="step.startedAt || step.finishedAt" class="flex gap-4 text-base-content/40 text-[10px]">
                      <span v-if="step.startedAt">Начало: {{ formatDate(step.startedAt) }}</span>
                      <span v-if="step.finishedAt">Конец: {{ formatDate(step.finishedAt) }}</span>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-if="steps.length === 0" class="text-center py-8 text-base-content/50">
        <Icon name="mingcute:inbox-line" class="text-3xl mb-2" />
        <p>Шагов пока нет</p>
      </div>
    </template>
  </div>
</template>
