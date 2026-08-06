<script setup lang="ts">
/**
 * Монитор запуска конвейера. Макет: design-preview/catalog/05-run-monitor.dc.html
 *
 * Слева список запусков, в центре хронология шагов, справа схема конвейера с
 * подсветкой пройденного пути. Ниже 1280 боковые колонки уезжают: список — на
 * свою страницу, схема — в выдвижную панель.
 */
import type { RunStatus, WorkflowRun, WorkflowStep } from '~~/shared/types/workflow'
import type { WorkflowRunRow } from '~/composables/usePipelineRuns'
import { graphOrderIndex } from '~/components/pipeline/PipelineGraphOrder'
import { formatMoney } from '~~/shared/utils/money'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'pipeline' })

const route = useRoute()
const pipelineId = computed(() => route.params.id as string)
const runId = computed(() => route.params.runId as string)

const monitorStore = usePipelineMonitorStore()
const toast = useToast()

// localStorage читаем строго после монтирования: иначе SSR и первый клиентский
// рендер расходятся по режиму просмотра данных.
onMounted(() => monitorStore.hydrateFromStorage())

const { data, pending, error, refresh } = usePipelineRunDetail(pipelineId, runId)
const run = computed<WorkflowRun | null>(() => data.value?.data ?? null)

// Граф нужен схеме справа, порядку шагов и счётчику «шагов N из M»: сам запуск
// знает только те шаги, до которых дошёл. Снимок графа запуска точнее текущего
// состояния конвейера — его с тех пор могли перерисовать.
const { data: pipelineData } = usePipelineDetail(pipelineId)
const pipeline = computed(() => (pipelineData.value as any)?.data ?? null)
const graph = computed(() => (run.value as any)?.graphSnapshot ?? pipeline.value?.graphData ?? null)
const graphOrder = computed(() => graphOrderIndex(graph.value))
const totalNodes = computed(() => (graphOrder.value.size || null))
const pipelineName = computed(() => pipeline.value?.name ?? 'Запуск конвейера')

/**
 * Шаги идут в порядке графа, а не создания записей: движок заводит строку шага
 * заранее, и «в очереди» приезжали первыми — раньше уже выполненных.
 */
const steps = computed<WorkflowStep[]>(() => {
  const list = run.value?.steps ?? []
  const order = graphOrder.value
  if (!order.size) return list
  return [...list].sort((a, b) => {
    const ai = order.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER
    const bi = order.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
})

useHead({ title: computed(() => run.value ? `Запуск #${run.value.id}` : 'Запуск') })

// «Сейчас» держим отдельным ref: Date.now() прямо в разметке расходится при
// гидратации, а длительность идущего запуска должна расти вместе с опросом.
const now = ref<number | null>(null)
const updatedAt = ref<number | null>(null)
let tick: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  now.value = Date.now()
  updatedAt.value = Date.now()
  tick = setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => { if (tick) clearInterval(tick) })

watch(data, () => { if (import.meta.client) updatedAt.value = Date.now() })

// ── Список запусков слева ─────────────────────────────────────────────────
// Страницы накапливаются вычислением, а не watcher'ом: на сервере watch не
// срабатывает, и список приезжал пустым в SSR, а после гидратации — полным.
const listPage = ref(1)
const listStatuses = ref<RunStatus[]>([])
const failedOnly = computed(() => listStatuses.value.includes('failed'))
const { data: runsData, pending: runsPending } = usePipelineRuns(pipelineId, listPage, {
  statuses: listStatuses,
})
const previousPages = ref<WorkflowRunRow[]>([])

const loadedRuns = computed<WorkflowRunRow[]>(() => {
  const current = runsData.value?.data ?? []
  if (!previousPages.value.length) return current
  const seen = new Set(previousPages.value.map(r => r.id))
  return [...previousPages.value, ...current.filter(r => !seen.has(r.id))]
})

function loadMoreRuns() {
  previousPages.value = loadedRuns.value.slice()
  listPage.value += 1
}

/** Отбор считает сервер: по загруженным страницам счёт был бы неполным. */
function setFailedOnly(value: boolean) {
  listStatuses.value = value ? ['failed'] : []
  previousPages.value = []
  listPage.value = 1
}

const runsMeta = computed(() => runsData.value?.meta ?? null)
const hasMoreRuns = computed(() => {
  const meta = runsMeta.value
  return !!meta && meta.page < meta.totalPages
})

// ── Нормы длительности ────────────────────────────────────────────────────
// Отдельный запрос: запуск опрашивается раз в две секунды, а нормы меняются
// днями. Медиана по типу блока за две недели — см. /api/pipelines/step-norms.
const { data: normsData } = useFetch<{
  data: { slowFactor: number; norms: Array<{ nodeType: string; medianMs: number }> }
}>('/api/pipelines/step-norms', { key: 'pipeline-step-norms' })

const stepNorms = computed(() => {
  const list = normsData.value?.data?.norms ?? []
  return list.length ? new Map(list.map(n => [n.nodeType, n.medianMs])) : null
})
const slowFactor = computed(() => normsData.value?.data?.slowFactor ?? 3)

// ── Вкладки ───────────────────────────────────────────────────────────────
const tab = ref<'steps' | 'gantt' | 'logs'>('steps')
const logStepFilter = ref('')

const logAlerts = computed(() => {
  let count = 0
  for (const step of steps.value) {
    const logs = Array.isArray(step.logs) ? step.logs : []
    count += logs.filter(l => l.level === 'warn' || l.level === 'error').length
  }
  return count
})

// ── Шаги ──────────────────────────────────────────────────────────────────
// Упавший и идущий шаги раскрыты сразу: за ними и приходят. Раскрытие по
// умолчанию выводится из данных, а не выставляется watcher'ом: на сервере
// watch не срабатывает, и первый клиентский рендер расходился с разметкой.
const userExpanded = ref<Set<number> | null>(null)

const defaultExpanded = computed(() =>
  new Set(steps.value.filter(s => s.status === 'failed' || s.status === 'running').map(s => s.id)),
)

const expandedSteps = computed(() => userExpanded.value ?? defaultExpanded.value)

function toggleStep(id: number) {
  const next = new Set(expandedSteps.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  userExpanded.value = next
}

const nodeLabels = computed(() => {
  const map = new Map<string, string>()
  for (const step of steps.value) map.set(step.nodeId, step.nodeName || step.nodeId)
  return map
})

function openStepLogs(step: WorkflowStep) {
  logStepFilter.value = step.nodeId
  tab.value = 'logs'
}

// ── Действия ──────────────────────────────────────────────────────────────
const canCancel = computed(() =>
  !!run.value && ['running', 'pending'].includes(run.value.status) && !run.value.cancelRequestedAt,
)
const canReplay = computed(() =>
  !!run.value && ['success', 'failed', 'cancelled', 'no_data'].includes(run.value.status),
)
/** Повтор шага engine умеет только на завершившемся неуспехом запуске. */
const canRetrySteps = computed(() =>
  !!run.value && ['failed', 'cancelled'].includes(run.value.status),
)

function isStepRetryable(step: WorkflowStep) {
  return canRetrySteps.value && ['failed', 'cancelled'].includes(step.status)
}

const cancelling = ref(false)
const replaying = ref(false)
const retryingNodeId = ref<string | null>(null)
const skippingNodeId = ref<string | null>(null)

const confirm = ref<null | { kind: 'cancel' | 'replay' | 'retry' | 'skip'; step?: WorkflowStep }>(null)

/**
 * Во что обошёлся запуск в прошлый раз — это и есть ожидаемая цена повтора.
 * Оценка, а не счёт: граф и цены провайдеров могли поменяться.
 */
const replayPrice = computed(() => formatMoney(run.value?.costActual))

/** Цена повтора с шага — сумма этого шага и всего, что ниже по графу. */
const retryPrice = computed(() => {
  const step = confirm.value?.step
  if (!step) return null
  const from = steps.value.findIndex(s => s.id === step.id)
  if (from < 0) return null
  const spent = steps.value
    .slice(from)
    .reduce<number | null>((sum, s) => (s.costActual == null ? sum : (sum ?? 0) + s.costActual), null)
  return formatMoney(spent)
})

async function doCancel() {
  confirm.value = null
  cancelling.value = true
  try {
    await $fetch(`/api/pipelines/${pipelineId.value}/runs/${runId.value}/cancel`, { method: 'POST' })
    await refresh()
    toast.info('Остановка запрошена — активные операции прерываются')
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось остановить запуск')
  }
  finally {
    cancelling.value = false
  }
}

async function doReplay() {
  confirm.value = null
  replaying.value = true
  try {
    const res = await $fetch<{ data: { runId: number } }>(
      `/api/pipelines/${pipelineId.value}/runs/${runId.value}/replay`,
      { method: 'POST' },
    )
    if (res?.data?.runId) await navigateTo(`/pipeline/${pipelineId.value}/runs/${res.data.runId}`)
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось перезапустить')
  }
  finally {
    replaying.value = false
  }
}

async function doRetryStep(step: WorkflowStep) {
  confirm.value = null
  retryingNodeId.value = step.nodeId
  try {
    const res = await $fetch<{ data: { retriedNodeId: string; downstreamReset: string[] } }>(
      `/api/pipelines/${pipelineId.value}/runs/${runId.value}/retry-step`,
      { method: 'POST', body: { nodeId: step.nodeId } },
    )
    await refresh()
    toast.success(
      `Запуск возобновлён с шага «${step.nodeName || step.nodeId}». Сброшено шагов ниже: ${res.data.downstreamReset.length}`,
    )
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось повторить шаг')
  }
  finally {
    retryingNodeId.value = null
  }
}

async function doSkipStep(step: WorkflowStep) {
  confirm.value = null
  skippingNodeId.value = step.nodeId
  try {
    await $fetch(`/api/pipelines/${pipelineId.value}/runs/${runId.value}/skip-step`, {
      method: 'POST',
      body: { nodeId: step.nodeId },
    })
    await refresh()
    toast.success(`Шаг «${step.nodeName || step.nodeId}» пропущен, запуск продолжен`)
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось пропустить шаг')
  }
  finally {
    skippingNodeId.value = null
  }
}

function requestRetryFromFailed() {
  const step = steps.value.find(s => s.status === 'failed')
  if (step) confirm.value = { kind: 'retry', step }
}

async function copyRunId() {
  try {
    await navigator.clipboard.writeText(String(runId.value))
    toast.success('Номер запуска скопирован')
  }
  catch {
    toast.error('Буфер обмена недоступен')
  }
}

const schemeOpen = ref(false)
</script>

<template>
  <div class="flex h-full min-h-0">
    <PipelineMonitorRunsPanel
      class="hidden w-72 flex-none border-r xl:flex"
      :pipeline-id="pipelineId"
      :runs="loadedRuns"
      :total="runsMeta?.total ?? null"
      :failed-count="runsMeta?.statusCounts?.failed ?? null"
      :pending="runsPending"
      :current-run-id="run?.id ?? null"
      :has-more="hasMoreRuns"
      :failed-only="failedOnly"
      @update:failed-only="setFailedOnly"
      @more="loadMoreRuns"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <UiSkeleton v-if="pending && !run" variant="details" :count="8" class="p-4" />

      <UiErrorState
        v-else-if="error"
        class="m-4"
        message="Не удалось загрузить запуск."
        :details="error.message"
        @retry="refresh()"
      />

      <template v-else-if="run">
        <PipelineMonitorRunHeader
          :run="run"
          :steps="steps"
          :pipeline-name="pipelineName"
          :pipeline-id="pipelineId"
          :total-nodes="totalNodes"
          :tab="tab"
          :log-alerts="logAlerts"
          :now="now"
          :updated-at="updatedAt"
          :can-cancel="canCancel"
          :can-replay="canReplay"
          :cancelling="cancelling"
          :replaying="replaying"
          @update:tab="(v) => { tab = v }"
          @cancel="confirm = { kind: 'cancel' }"
          @replay="confirm = { kind: 'replay' }"
          @retry-failed="requestRetryFromFailed"
          @copy-id="copyRunId"
        />

        <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-5">
          <p
            v-if="run.cancelRequestedAt && run.status === 'running'"
            class="mb-3 flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
          >
            <Icon name="mingcute:loading-line" class="mt-0.5 shrink-0 animate-spin text-warning" />
            <span>Остановка в процессе: активные процессы прерываются, внешние операции отменяются где это возможно.</span>
          </p>

          <p
            v-else-if="run.errorMessage"
            class="mb-3 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-fg"
          >
            <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
            <span class="min-w-0 flex-1">{{ run.errorMessage }}</span>
          </p>

          <p
            v-else-if="run.status === 'no_data'"
            class="mb-3 flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
          >
            <Icon name="mingcute:inbox-line" class="mt-0.5 shrink-0 text-warning" />
            <span>Конвейер отработал технически корректно, но источник не вернул полезного контента. Это не ошибка — но и не полноценный успех.</span>
          </p>

          <div class="mb-3 flex xl:hidden">
            <UiButton :disabled="!graph" @click="schemeOpen = true">
              <Icon name="mingcute:git-branch-line" />
              Схема запуска
            </UiButton>
          </div>

          <template v-if="tab === 'steps'">
            <UiEmptyState
              v-if="!steps.length"
              title="Шагов пока нет"
              description="Запуск ещё не дошёл до первого блока графа."
            />
            <div v-else class="flex flex-col gap-[7px]">
              <PipelineMonitorStepRow
                v-for="(step, index) in steps"
                :key="step.id"
                :step="step"
                :index="index"
                :expanded="expandedSteps.has(step.id)"
                :now="now"
                @toggle="toggleStep(step.id)"
              >
                <PipelineMonitorStepDetails
                  :step="step"
                  :pipeline-id="pipelineId"
                  :data-mode="monitorStore.dataFormat"
                  :retryable="isStepRetryable(step)"
                  :retrying="retryingNodeId === step.nodeId"
                  :skipping="skippingNodeId === step.nodeId"
                  :node-labels="nodeLabels"
                  @retry="confirm = { kind: 'retry', step }"
                  @skip="confirm = { kind: 'skip', step }"
                  @logs="openStepLogs(step)"
                  @update:data-mode="(v) => { monitorStore.dataFormat = v }"
                />
              </PipelineMonitorStepRow>
              <p class="px-2.5 text-micro text-subtle">
                Новые шаги появляются снизу. У шагов «в очереди» высота та же, что у
                выполненных — при обновлении раз в две секунды вёрстка не дёргается.
              </p>
            </div>
          </template>

          <PipelineMonitorRunGantt
            v-else-if="tab === 'gantt'"
            :steps="steps"
            :run-started-at="run.startedAt"
            :run-finished-at="run.finishedAt"
            :now="now"
            :norms="stepNorms"
            :slow-factor="slowFactor"
          />

          <PipelineMonitorRunLogs
            v-else
            :steps="steps"
            :step-filter="logStepFilter"
            @update:step-filter="(v) => { logStepFilter = v }"
          />
        </div>
      </template>
    </div>

    <PipelineMonitorRunSchemeAside
      v-if="run"
      class="hidden w-60 flex-none xl:flex"
      :graph="graph"
      :steps="steps"
      :editor-href="`/pipeline/${pipelineId}`"
    />

    <UiDrawer :open="schemeOpen" title="Где мы в графе" width="320px" @close="schemeOpen = false">
      <PipelineMonitorRunSchemeAside
        v-if="run"
        class="h-full border-l-0"
        :graph="graph"
        :steps="steps"
        :editor-href="`/pipeline/${pipelineId}`"
      />
    </UiDrawer>

    <UiModal
      :open="!!confirm"
      size="sm"
      :title="confirm?.kind === 'cancel'
        ? 'Остановить запуск?'
        : confirm?.kind === 'replay'
          ? 'Повторить запуск?'
          : confirm?.kind === 'skip' ? 'Пропустить шаг?' : 'Повторить с этого шага?'"
      @close="confirm = null"
    >
      <p v-if="confirm?.kind === 'cancel'" class="text-sm text-muted">
        Активные процессы будут прерваны, внешние операции отменены где это возможно.
        Уже сгенерированные материалы сохранятся.
      </p>
      <p v-else-if="confirm?.kind === 'replay'" class="text-sm text-muted">
        Конвейер отработает заново с теми же параметрами. Платные шаги будут
        оплачены повторно:
        <template v-if="replayPrice">
          в прошлый раз запуск обошёлся в <span class="tnum font-mono text-fg">{{ replayPrice }}</span>,
          цены провайдеров с тех пор могли поменяться.
        </template>
        <template v-else>сумму прошлого запуска посчитать не удалось.</template>
      </p>
      <p v-else-if="confirm?.kind === 'skip'" class="text-sm text-muted">
        Шаг «{{ confirm?.step?.nodeName || confirm?.step?.nodeId }}» будет отмечен
        пропущенным, и запуск продолжится со следующего блока. Блоки ниже получат
        пустой вход от этого шага — как если бы он ничего не вернул. Причина отказа
        останется в разборе. Пропуск ничего не переисполняет и не стоит денег.
      </p>
      <p v-else class="text-sm text-muted">
        Шаг «{{ confirm?.step?.nodeName || confirm?.step?.nodeId }}» выполнится заново,
        все шаги ниже по графу — тоже. Успешные шаги выше переиспользуются из кэша
        и повторно не оплачиваются.
        <template v-if="retryPrice">
          В прошлый раз этот отрезок обошёлся в
          <span class="tnum font-mono text-fg">{{ retryPrice }}</span>.
        </template>
      </p>

      <template #footer>
        <UiButton variant="ghost" @click="confirm = null">Отмена</UiButton>
        <UiButton
          v-if="confirm?.kind === 'cancel'"
          variant="danger"
          :loading="cancelling"
          @click="doCancel()"
        >
          Остановить
        </UiButton>
        <UiButton
          v-else-if="confirm?.kind === 'replay'"
          variant="primary"
          :loading="replaying"
          @click="doReplay()"
        >
          Повторить запуск
        </UiButton>
        <UiButton
          v-else-if="confirm?.kind === 'skip'"
          variant="primary"
          :loading="!!skippingNodeId"
          @click="doSkipStep(confirm!.step!)"
        >
          Пропустить и продолжить
        </UiButton>
        <UiButton
          v-else
          variant="primary"
          :loading="!!retryingNodeId"
          @click="doRetryStep(confirm!.step!)"
        >
          Повторить шаг
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
