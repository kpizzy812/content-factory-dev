<script setup lang="ts">
/**
 * Запуски по всем конвейерам. Макет: design-preview/catalog/05-run-monitor.dc.html
 *
 * Отвечает на вопрос «что происходило на заводе», на который каталог
 * конвейеров не отвечает: там надо раскрыть каждую карточку и сложить в уме.
 * Активные закреплены сверху, история сгруппирована по дням.
 *
 * Отбор по статусу, конвейеру и дню уходит на сервер: считать их по
 * загруженным страницам значит показывать неправду при любой пагинации.
 */
import type { RunStatus } from '~~/shared/types/workflow'
import type { WorkflowRunRow } from '~/composables/usePipelineRuns'
import { RUN_STATUS_META } from '~/components/pipeline/PipelineRunStatusMap'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'pipeline' })
useHead({ title: 'Запуски конвейеров' })

const page = ref(1)
const statuses = ref<RunStatus[]>([])
const pipelineFilter = ref<number | null>(null)
const day = ref<string | null>(null)

const failedOnly = computed(() => statuses.value.includes('failed'))

const { data, pending, error, refresh } = useAllPipelineRuns(page, {
  statuses,
  day,
  pipelineId: pipelineFilter,
})

// Список конвейеров для фильтра берём из монитора: он уже знает, к чему у
// человека есть доступ, и лежит в кэше после каталога.
const { data: monitorData } = useFetch<{ data: Array<{ id: number; name: string }> }>(
  '/api/pipelines/monitor',
  { key: 'pipeline-filter-options', query: { perPage: 50 } },
)
const pipelineOptions = computed(() => [
  { value: '', label: 'Все конвейеры' },
  ...(monitorData.value?.data ?? []).map(p => ({ value: p.id, label: p.name })),
])

const statusOptions = computed(() => [
  { value: '', label: 'Все статусы' },
  ...Object.entries(RUN_STATUS_META).map(([key, meta]) => ({ value: key, label: meta.label })),
])

// Страницы накапливаются вычислением, а не watcher'ом: на сервере watch не
// срабатывает, и список приезжал пустым в SSR, а после гидратации — полным.
const previousPages = ref<WorkflowRunRow[]>([])

const loaded = computed<WorkflowRunRow[]>(() => {
  const current = data.value?.data ?? []
  if (!previousPages.value.length) return current
  const seen = new Set(previousPages.value.map(r => r.id))
  return [...previousPages.value, ...current.filter(r => !seen.has(r.id))]
})

function loadMore() {
  previousPages.value = loaded.value.slice()
  page.value += 1
}

/** Любая смена отбора начинает список заново. */
function resetPaging() {
  previousPages.value = []
  page.value = 1
}

function setStatus(value: string | number) {
  statuses.value = value ? [String(value) as RunStatus] : []
  resetPaging()
}

function setFailedOnly(value: boolean) {
  statuses.value = value ? ['failed'] : []
  resetPaging()
}

function setPipeline(value: string | number) {
  pipelineFilter.value = value ? Number(value) : null
  resetPaging()
}

function setDay(value: string) {
  day.value = value || null
  resetPaging()
}

const meta = computed(() => data.value?.meta ?? null)
const hasMore = computed(() => !!meta.value && meta.value.page < meta.value.totalPages)

const stats = computed(() => {
  const counts = meta.value?.statusCounts
  if (!counts) return null
  return {
    total: meta.value?.statusTotal ?? 0,
    active: counts.running + counts.pending,
    success: counts.success,
    failed: counts.failed,
  }
})

/** Пусто по фильтру и пусто вообще — разные состояния. */
const filtered = computed(() =>
  statuses.value.length > 0 || pipelineFilter.value != null || day.value != null,
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex flex-none flex-col gap-2 border-b border-border bg-panel px-4 py-2.5">
      <div class="flex flex-wrap items-center gap-2.5">
        <h1 class="min-w-0 flex-1 truncate text-lg font-semibold">Запуски конвейеров</h1>

        <div v-if="stats" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span class="tnum">всего {{ stats.total }}</span>
          <span v-if="stats.active" class="tnum inline-flex items-center gap-1.5 text-info">
            <span class="size-1.5 rounded-full bg-info motion-safe:animate-pulse" />
            {{ stats.active }} активных
          </span>
          <span v-if="stats.success" class="tnum text-success">{{ stats.success }} успешных</span>
          <span v-if="stats.failed" class="tnum text-danger">{{ stats.failed }} упало</span>
        </div>

        <UiButton :loading="pending" @click="refresh()">
          <Icon v-if="!pending" name="mingcute:refresh-3-line" />
          Обновить
        </UiButton>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <UiSelect
          class="w-52"
          :model-value="pipelineFilter ?? ''"
          :options="pipelineOptions"
          aria-label="Конвейер"
          @update:model-value="setPipeline"
        />
        <UiSelect
          class="w-44"
          :model-value="statuses[0] ?? ''"
          :options="statusOptions"
          aria-label="Статус"
          @update:model-value="setStatus"
        />
        <UiInput
          class="max-w-44"
          type="date"
          :model-value="day ?? ''"
          aria-label="День"
          @update:model-value="setDay"
        />
        <span class="text-micro text-subtle">
          Выберите день — счётчики в заголовке посчитаются за него.
        </span>
      </div>
    </header>

    <UiErrorState
      v-if="error"
      class="m-4"
      message="Не удалось загрузить запуски."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!pending && !loaded.length && !filtered"
      class="m-4"
      variant="first"
      title="Запусков пока нет"
      description="Запустите конвейер вручную, по расписанию или через вебхук — история появится здесь."
    />

    <PipelineMonitorRunsPanel
      v-else
      class="mx-auto min-h-0 w-full max-w-3xl flex-1 border-x"
      embedded
      show-pipeline
      pipeline-id=""
      :runs="loaded"
      :total="meta?.total ?? null"
      :failed-count="stats?.failed ?? null"
      :pending="pending"
      :has-more="hasMore"
      :failed-only="failedOnly"
      @update:failed-only="setFailedOnly"
      @more="loadMore"
    />
  </div>
</template>
