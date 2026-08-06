<script setup lang="ts">
/**
 * История запусков конвейера. Макет: design-preview/catalog/05-run-monitor.dc.html
 *
 * Тот же список, что в левой колонке монитора, только во всю ширину: активные
 * закреплены сверху, история сгруппирована по дням. Отдельного экрана «все
 * запуски по всем конвейерам» нет — общего endpoint под него не существует.
 */
import type { WorkflowRun } from '~~/shared/types/workflow'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'pipeline' })

const route = useRoute()
const pipelineId = computed(() => route.params.id as string)

const page = ref(1)
const failedOnly = ref(false)

const { data, pending, error, refresh } = usePipelineRuns(pipelineId, page)
const { data: pipelineData } = usePipelineDetail(pipelineId)
const pipelineName = computed(() => (pipelineData.value as any)?.data?.name ?? 'Конвейер')

useHead({ title: computed(() => `Запуски · ${pipelineName.value}`) })

// Страницы накапливаются вычислением, а не watcher'ом: на сервере watch не
// срабатывает, и список приезжал пустым в SSR, а после гидратации — полным.
const previousPages = ref<WorkflowRun[]>([])

const loaded = computed<WorkflowRun[]>(() => {
  const current = data.value?.data ?? []
  if (!previousPages.value.length) return current
  const seen = new Set(previousPages.value.map(r => r.id))
  return [...previousPages.value, ...current.filter(r => !seen.has(r.id))]
})

function loadMore() {
  previousPages.value = loaded.value.slice()
  page.value += 1
}

const visibleRuns = computed(() =>
  failedOnly.value ? loaded.value.filter(r => r.status === 'failed') : loaded.value,
)

const meta = computed(() => data.value?.meta ?? null)
const hasMore = computed(() => !!meta.value && meta.value.page < meta.value.totalPages)

// Сводка считается по загруженным страницам: `/api/pipelines/:id/runs` отдаёт
// только общее число, разбивки по статусам в мете нет.
const stats = computed(() => {
  const list = loaded.value
  return {
    active: list.filter(r => r.status === 'running' || r.status === 'pending').length,
    success: list.filter(r => r.status === 'success').length,
    failed: list.filter(r => r.status === 'failed').length,
  }
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex flex-none flex-wrap items-center gap-2.5 border-b border-border bg-panel px-4 py-2.5">
      <NuxtLink
        :to="`/pipeline/${pipelineId}`"
        class="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm text-muted no-underline hover:bg-card hover:text-fg"
      >
        <Icon name="mingcute:left-line" />
        К редактору
      </NuxtLink>
      <h1 class="min-w-0 flex-1 truncate text-lg font-semibold">Запуски · {{ pipelineName }}</h1>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span v-if="meta" class="tnum">всего {{ meta.total }}</span>
        <span v-if="stats.active" class="tnum inline-flex items-center gap-1.5 text-info">
          <span class="size-1.5 rounded-full bg-info motion-safe:animate-pulse" />
          {{ stats.active }} активных
        </span>
        <span v-if="stats.success" class="tnum text-success">{{ stats.success }} успешных</span>
        <span v-if="stats.failed" class="tnum text-danger">{{ stats.failed }} упало</span>
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
      v-else-if="!pending && !loaded.length"
      class="m-4"
      variant="first"
      title="Запусков пока нет"
      description="Запустите конвейер вручную, по расписанию или через вебхук — история появится здесь."
    />

    <PipelineMonitorRunsPanel
      v-else
      class="mx-auto min-h-0 w-full max-w-3xl flex-1 border-x"
      embedded
      :pipeline-id="pipelineId"
      :runs="visibleRuns"
      :total="meta?.total ?? null"
      :pending="pending"
      :has-more="hasMore"
      :failed-only="failedOnly"
      @update:failed-only="(v) => { failedOnly = v }"
      @more="loadMore"
    />
  </div>
</template>
