<script setup lang="ts">
/**
 * История запусков конвейера. Макет: design-preview/catalog/05-run-monitor.dc.html
 *
 * Тот же список, что в левой колонке монитора, только во всю ширину: активные
 * закреплены сверху, история сгруппирована по дням. Общий экран по всем
 * конвейерам живёт отдельно — `/pipeline/runs`.
 *
 * Отбор «только упавшие» уходит на сервер: считать его по загруженным
 * страницам значит показывать неправду при любой пагинации.
 */
import type { RunStatus } from '~~/shared/types/workflow'
import type { WorkflowRunRow } from '~/composables/usePipelineRuns'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'pipeline' })

const route = useRoute()
const pipelineId = computed(() => route.params.id as string)

const page = ref(1)
const statuses = ref<RunStatus[]>([])
const failedOnly = computed(() => statuses.value.includes('failed'))

const { data, pending, error, refresh } = usePipelineRuns(pipelineId, page, { statuses })
const { data: pipelineData } = usePipelineDetail(pipelineId)
const pipelineName = computed(() => (pipelineData.value as any)?.data?.name ?? 'Конвейер')

useHead({ title: computed(() => `Запуски · ${pipelineName.value}`) })

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

/** Смена отбора начинает список заново: накопленные страницы к нему не относятся. */
function setFailedOnly(value: boolean) {
  statuses.value = value ? ['failed'] : []
  previousPages.value = []
  page.value = 1
}

const meta = computed(() => data.value?.meta ?? null)
const hasMore = computed(() => !!meta.value && meta.value.page < meta.value.totalPages)

// Сводка приходит из меты и считается по всей истории, а не по загруженному.
const stats = computed(() => {
  const counts = meta.value?.statusCounts
  if (!counts) return null
  return {
    active: counts.running + counts.pending,
    success: counts.success,
    failed: counts.failed,
    total: meta.value?.statusTotal ?? 0,
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

      <div v-if="stats" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span class="tnum">всего {{ stats.total }}</span>
        <span v-if="stats.active" class="tnum inline-flex items-center gap-1.5 text-info">
          <span class="size-1.5 rounded-full bg-info motion-safe:animate-pulse" />
          {{ stats.active }} активных
        </span>
        <span v-if="stats.success" class="tnum text-success">{{ stats.success }} успешных</span>
        <span v-if="stats.failed" class="tnum text-danger">{{ stats.failed }} упало</span>
      </div>

      <NuxtLink to="/pipeline/runs" class="text-sm">Все конвейеры</NuxtLink>
    </header>

    <UiErrorState
      v-if="error"
      class="m-4"
      message="Не удалось загрузить запуски."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!pending && !loaded.length && !failedOnly"
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
