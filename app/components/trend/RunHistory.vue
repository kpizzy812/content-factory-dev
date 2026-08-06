<script setup lang="ts">
/**
 * История запусков парсинга — по одному профилю или по всем сразу.
 *
 * Колонка результата отвечает на единственный вопрос, ради которого сюда
 * заходят: сколько трендов приехало и почему не приехало. Поэтому импорт и
 * причина отказа стоят в одной колонке, а не в двух — их не читают вместе.
 */
import { trendRunStatus } from './TrendRunStatusMap'

const props = defineProps<{
  profileId?: number
  profileName?: string
}>()

const emit = defineEmits<{
  close: []
  showDetail: [runId: number]
}>()

const profileIdRef = computed(() => props.profileId)
const { runs, meta, page, pending } = useTrendwatcherRunHistory(profileIdRef as Ref<number | undefined>)

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'вручную',
  scheduled: 'расписание',
  pipeline: 'конвейер',
}

/** Шаг, на котором встало. Сокращения — колонка узкая. */
const STEP_LABELS: Record<string, string> = {
  init: 'иниц.',
  starting: 'запуск',
  running: 'Apify',
  importing: 'импорт',
  completed: 'заверш.',
  canceled: 'отмена',
  unknown: '?',
  watchdog: 'watchdog',
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'идёт'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms} мс`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} с`
  return `${Math.floor(sec / 60)} м ${String(sec % 60).padStart(2, '0')} с`
}

type Run = typeof runs.value[number]

function result(run: Run): { text: string; tone: string } | null {
  if (run.importedCount > 0) return { text: `+${run.importedCount}`, tone: 'text-success' }
  if (run.status === 'completed') return { text: 'ничего не нашлось', tone: 'text-subtle' }
  const reason = run.errorSummary || run.failureReason
  return reason ? { text: reason, tone: 'text-danger' } : null
}

const COLUMNS = '64px 116px 108px 132px 88px 84px minmax(0,1fr) 28px'
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2.5">
      <Icon name="mingcute:history-line" class="shrink-0 text-muted" />
      <h3 class="text-base font-semibold">История запусков</h3>
      <span v-if="profileName" class="min-w-0 truncate text-sm text-muted">· {{ profileName }}</span>
      <span class="flex-1" />
      <UiButton variant="ghost" aria-label="Закрыть" @click="emit('close')">
        <Icon name="mingcute:close-line" />
      </UiButton>
    </header>

    <UiSkeleton v-if="pending && !runs.length" variant="table" :count="6" class="p-3" />

    <UiEmptyState
      v-else-if="!runs.length"
      class="m-3"
      title="Запусков пока нет"
      description="Запустите профиль вручную или дождитесь расписания."
    />

    <template v-else>
      <UiTable :columns="COLUMNS" min-width="820px" class="rounded-none border-0">
        <UiTableHead>
          <span>Номер</span>
          <span>Статус</span>
          <span>Способ</span>
          <span>Старт</span>
          <span>Длительность</span>
          <span>Шаг</span>
          <span>Результат</span>
          <span />
        </UiTableHead>

        <UiTableRow
          v-for="run in runs"
          :key="run.id"
          role="button"
          tabindex="0"
          @click="emit('showDetail', run.id)"
          @keydown.enter="emit('showDetail', run.id)"
        >
          <span class="tnum font-mono text-sm text-muted">{{ run.id }}</span>
          <span><TrendRunStatusBadge :status="run.status" size="xs" /></span>
          <span class="truncate text-sm text-muted">
            {{ TRIGGER_LABELS[run.triggerType] ?? run.triggerType }}
          </span>
          <ClientOnly>
            <span class="tnum truncate font-mono text-sm text-muted">{{ formatDate(run.startedAt) }}</span>
            <template #fallback><span /></template>
          </ClientOnly>
          <span class="tnum font-mono text-sm text-muted">
            {{ formatDuration(run.startedAt, run.completedAt) }}
          </span>
          <span class="truncate text-sm text-subtle">
            {{ run.errorStep ? (STEP_LABELS[run.errorStep] ?? run.errorStep) : '' }}
          </span>
          <span class="flex min-w-0 items-center gap-1.5">
            <span v-if="result(run)" class="truncate text-sm" :class="result(run)!.tone" :title="result(run)!.text">
              {{ result(run)!.text }}
            </span>
            <Icon
              v-if="run.canRetry && run.status === 'failed'"
              name="mingcute:refresh-2-line"
              class="shrink-0 text-info"
              title="Можно повторить"
            />
            <Icon
              v-if="run.needsProfileFix"
              name="mingcute:settings-2-line"
              class="shrink-0 text-warning"
              title="Нужно поправить профиль"
            />
          </span>
          <Icon name="mingcute:right-line" class="justify-self-end text-subtle" />
        </UiTableRow>
      </UiTable>

      <div v-if="meta.totalPages > 1" class="flex items-center justify-center gap-2 px-3 py-2.5">
        <UiButton variant="ghost" :disabled="page <= 1" aria-label="Предыдущая" @click="page--">
          <Icon name="mingcute:left-line" />
        </UiButton>
        <span class="tnum font-mono text-sm text-muted">{{ page }} / {{ meta.totalPages }}</span>
        <UiButton variant="ghost" :disabled="page >= meta.totalPages" aria-label="Следующая" @click="page++">
          <Icon name="mingcute:right-line" />
        </UiButton>
      </div>
    </template>
  </section>
</template>
