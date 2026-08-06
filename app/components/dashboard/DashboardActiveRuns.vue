<script setup lang="ts">
/**
 * Запуски конвейеров, которые идут прямо сейчас. Источник: `ActiveRunsList`
 * из макета 01.
 *
 * Данные берёт общий список запусков с фильтром по статусу — тот же, что и
 * экран «Запуски». Раньше здесь стоял каталог конвейеров с вложенными
 * запусками, и из него не выходило ни прогресса, ни стоимости.
 *
 * Прогресс — блоков пройдено из блоков в снимке графа запуска. Снимок, а не
 * текущий граф конвейера: его с тех пор могли перерисовать.
 */
import type { WorkflowRunRow } from '~/composables/usePipelineRuns'
import { runCostLabel } from '~/components/pipeline/PipelineRunFormat'

const { data, pending } = useFetch<{ data: WorkflowRunRow[] }>('/api/pipelines/runs', {
  key: 'dashboard-active-runs',
  query: { status: 'running,pending', perPage: 20 },
  lazy: true,
})

const rows = computed(() =>
  [...(data.value?.data ?? [])].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  ),
)

/** Доля пройденных блоков. null — снимка графа нет, считать не из чего. */
function progress(run: WorkflowRunRow): number | null {
  const total = run.totalNodes ?? 0
  if (!total) return null
  return Math.min(100, Math.round(((run.doneSteps ?? 0) / total) * 100))
}

function stepsLabel(run: WorkflowRunRow): string {
  const total = run.totalNodes ?? 0
  const done = run.doneSteps ?? 0
  return total ? `${done} из ${total}` : `${done}`
}

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
      <NuxtLink to="/pipeline/runs" class="text-sm">Все запуски</NuxtLink>
    </header>

    <UiSkeleton v-if="pending && !rows.length" variant="details" :count="3" />

    <p v-else-if="!rows.length" class="px-3.5 py-6 text-center text-sm text-subtle">
      Сейчас ничего не выполняется.
    </p>

    <ClientOnly v-else>
      <div
        v-for="run in rows"
        :key="run.id"
        class="grid grid-cols-[minmax(0,1fr)_minmax(0,180px)_96px_88px_max-content] items-center gap-3 border-b border-divider px-3.5 py-2.5 last:border-b-0 hover:bg-card"
      >
        <span class="min-w-0">
          <span class="block truncate text-sm">{{ run.pipeline?.name ?? 'Конвейер' }}</span>
          <span class="tnum block font-mono text-micro text-subtle">запуск {{ run.id }}</span>
        </span>
        <span class="truncate text-sm text-muted">{{ run.currentStep?.nodeName ?? 'шаг не начат' }}</span>
        <span class="min-w-0">
          <span class="tnum block font-mono text-micro text-subtle">блоков {{ stepsLabel(run) }}</span>
          <span v-if="progress(run) != null" class="mt-1 block h-1 overflow-hidden rounded-full bg-card">
            <span class="block h-full bg-info" :style="{ width: `${progress(run)}%` }" />
          </span>
        </span>
        <span class="tnum font-mono text-sm text-muted">
          {{ elapsed(run.startedAt) }}
          <span v-if="runCostLabel(run)" class="block text-micro text-subtle">{{ runCostLabel(run) }}</span>
        </span>
        <UiButton @click="navigateTo(`/pipeline/${run.pipelineId}/runs/${run.id}`)">Открыть</UiButton>
      </div>

      <template #fallback>
        <UiSkeleton variant="details" :count="3" />
      </template>
    </ClientOnly>
  </section>
</template>
