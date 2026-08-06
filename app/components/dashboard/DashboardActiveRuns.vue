<script setup lang="ts">
import type { PipelineMonitorItem, PipelineMonitorMeta } from '~~/shared/types/workflow'

/**
 * Запуски конвейеров, которые идут прямо сейчас. Источник: `ActiveRunsList`
 * из макета 01.
 *
 * Данные берутся у того же endpoint, что и страница конвейеров, но своим
 * запросом: стор монитора держит фильтры и поиск этой страницы, и делить его
 * с дашбордом значит связать их состояния.
 *
 * Прогресса в процентах в макете здесь нет и у нас: сводка отдаёт текущий шаг
 * и число шагов, а сколько всего шагов у запуска — знает только его конвейер.
 */
const { data, pending } = useFetch<{ data: PipelineMonitorItem[], meta: PipelineMonitorMeta }>(
  '/api/pipelines/monitor',
  { query: { perPage: 20, runsFilter: 'active' }, lazy: true },
)

interface Row {
  runId: number
  pipelineId: number
  pipelineName: string
  startedAt: string
  stepName: string | null
  stepsCount: number
}

const rows = computed<Row[]>(() => {
  const items = data.value?.data ?? []
  const out: Row[] = []
  for (const item of items) {
    for (const run of item.activeRuns) {
      out.push({
        runId: run.id,
        pipelineId: item.id,
        pipelineName: item.name,
        startedAt: run.startedAt,
        stepName: item.currentStep?.runId === run.id ? item.currentStep.nodeName : null,
        stepsCount: run.stepsCount,
      })
    }
  }
  return out.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
})

function elapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} мин`
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
      <h2 class="text-base font-semibold">Запуски в работе</h2>
      <span class="tnum font-mono text-sm text-subtle">{{ rows.length }}</span>
      <span class="flex-1" />
      <NuxtLink to="/pipeline" class="text-sm">Все конвейеры</NuxtLink>
    </header>

    <UiSkeleton v-if="pending && !rows.length" variant="details" :count="3" />

    <p v-else-if="!rows.length" class="px-3.5 py-6 text-center text-sm text-subtle">
      Сейчас ничего не выполняется.
    </p>

    <ClientOnly v-else>
      <div
        v-for="row in rows"
        :key="row.runId"
        class="grid grid-cols-[minmax(0,1fr)_minmax(0,180px)_88px_max-content] items-center gap-3 border-b border-divider px-3.5 py-2.5 last:border-b-0 hover:bg-card"
      >
        <span class="min-w-0">
          <span class="block truncate text-sm">{{ row.pipelineName }}</span>
          <span class="tnum block font-mono text-micro text-subtle">запуск {{ row.runId }}</span>
        </span>
        <span class="truncate text-sm text-muted">{{ row.stepName ?? 'шаг не начат' }}</span>
        <span class="tnum font-mono text-sm text-muted">{{ elapsed(row.startedAt) }}</span>
        <UiButton @click="navigateTo(`/pipeline/${row.pipelineId}/runs/${row.runId}`)">Открыть</UiButton>
      </div>

      <template #fallback>
        <UiSkeleton variant="details" :count="3" />
      </template>
    </ClientOnly>
  </section>
</template>
