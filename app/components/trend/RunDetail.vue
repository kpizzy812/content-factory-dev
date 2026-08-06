<script setup lang="ts">
/**
 * Разбор запуска парсинга.
 *
 * Отвечает по порядку на три вопроса: что случилось, что делать дальше и
 * какие цифры приехали. Поэтому подсказка «исправьте профиль» стоит выше
 * счётчиков, а не в конце, куда её сдвинула бы хронология.
 *
 * «Копировать диагностику» собирает всё, что нужно инженеру, одной строкой:
 * иначе оператор пересказывает ошибку своими словами.
 */
import { isTrendRunActive, trendRunStatus } from './TrendRunStatusMap'

const props = defineProps<{
  runId: number
}>()

const emit = defineEmits<{
  close: []
  showDetail: [runId: number]
}>()

const runIdRef = computed(() => props.runId)
const { run, pending, isActive, cancelRun, retryRun } = useTrendwatcherRunDetail(runIdRef as Ref<number | null>)

const toast = useToast()

const canceling = ref(false)
const retrying = ref(false)
const confirmCancel = ref(false)
const copied = ref(false)

/** Подписи подробнее общего словаря: у парсинга четыре разных «идёт». */
const STATUS_HEADLINE: Record<string, string> = {
  pending: 'Ожидает запуска',
  starting: 'Запускается',
  running: 'Apify выполняет парсинг',
  importing: 'Импорт трендов в базу',
  analyzing: 'Анализ трендов',
  completed: 'Успешно завершён',
  failed: 'Завершился с ошибкой',
  canceled: 'Отменён оператором',
  partially_completed: 'Частично завершён',
}

const ERROR_CATEGORY_LABELS: Record<string, string> = {
  profile_validation_error: 'Ошибка профиля',
  apify_start_failed: 'Apify не запустился',
  apify_run_failed: 'Прогон Apify упал',
  apify_timeout: 'Таймаут Apify',
  dataset_empty: 'Пустой набор данных',
  import_failed: 'Ошибка импорта',
  import_partial_failure: 'Импорт прошёл частично',
  canceled: 'Отменён',
  watchdog_failed: 'Watchdog не дождался',
  unknown_external_error: 'Неизвестная внешняя ошибка',
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'вручную',
  scheduled: 'по расписанию',
  pipeline: 'из конвейера',
}

const STEP_LABELS: Record<string, string> = {
  init: 'Инициализация',
  starting: 'Запуск актора',
  running: 'Выполнение Apify',
  importing: 'Импорт данных',
  completed: 'Завершение',
  canceled: 'Отмена',
  unknown: 'Неизвестный шаг',
  watchdog: 'Watchdog',
}

const status = computed(() => trendRunStatus(run.value?.status))
const headline = computed(() =>
  run.value ? STATUS_HEADLINE[run.value.status] ?? status.value.label : '',
)

const isTerminal = computed(() =>
  !!run.value && !isTrendRunActive(run.value.status),
)

const canRetryRun = computed(() =>
  !!run.value
  && ['failed', 'canceled', 'partially_completed'].includes(run.value.status)
  && run.value.canRetry,
)

const nextAction = computed(() => {
  if (!run.value || run.value.status === 'completed') return null
  if (run.value.needsProfileFix) {
    return { text: 'Исправьте настройки профиля и запустите снова', icon: 'mingcute:settings-2-line' }
  }
  if (run.value.canRetry) {
    return { text: 'Причина временная — запуск можно повторить', icon: 'mingcute:refresh-2-line' }
  }
  return null
})

/** Шаги по логам: одна строка на шаг, уровень — самый тревожный из его записей. */
const timeline = computed(() => {
  const logs = run.value?.logs ?? []
  if (!logs.length) return []
  const order: Array<{ step: string; label: string; level: string; time: string; count: number }> = []
  const seen = new Map<string, (typeof order)[number]>()

  for (const log of logs) {
    const step = log.step || 'unknown'
    const entry = seen.get(step)
    if (!entry) {
      const created = {
        step,
        label: STEP_LABELS[step] ?? step,
        level: log.level,
        time: new Date(log.createdAt).toLocaleTimeString('ru-RU'),
        count: 1,
      }
      seen.set(step, created)
      order.push(created)
    }
    else {
      entry.count += 1
      if (log.level === 'error') entry.level = 'error'
      else if (log.level === 'warn' && entry.level !== 'error') entry.level = 'warn'
    }
  }
  return order
})

const stepTone: Record<string, string> = {
  info: 'bg-info',
  warn: 'bg-warning',
  error: 'bg-danger',
}

const infoItems = computed(() => {
  const value = run.value
  if (!value) return []
  return [
    { label: 'Профиль', value: value.profile.name },
    { label: 'Актор', value: value.profile.actorId },
    { label: 'Способ', value: TRIGGER_LABELS[value.triggerType] ?? value.triggerType },
    { label: 'Инициатор', value: value.initiatedBy ?? '—' },
    { label: 'Старт', value: formatDate(value.startedAt) },
    { label: 'Завершение', value: formatDate(value.completedAt) },
    { label: 'Длительность', value: formatDuration(value.startedAt, value.completedAt) },
    ...(value.externalRunId ? [{ label: 'Прогон Apify', value: value.externalRunId }] : []),
  ]
})

const apifyTone = computed(() => {
  const value = run.value?.apifyStatus
  if (!value) return 'text-muted'
  if (value === 'SUCCEEDED') return 'text-success'
  if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(value)) return 'text-danger'
  return 'text-info'
})

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
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

async function handleCancel() {
  confirmCancel.value = false
  canceling.value = true
  try {
    await cancelRun()
  }
  finally {
    canceling.value = false
  }
}

async function handleRetry() {
  retrying.value = true
  try {
    const result = await retryRun()
    if (result?.runId) emit('showDetail', result.runId)
  }
  finally {
    retrying.value = false
  }
}

async function copyDiagnostics() {
  const value = run.value
  if (!value) return
  const lines = [
    `Запуск #${value.id}`,
    `Статус: ${value.status}`,
    value.errorSummary ? `Ошибка: ${value.errorSummary}` : '',
    value.errorCategory ? `Категория: ${value.errorCategory}` : '',
    value.errorStep ? `Шаг: ${value.errorStep}` : '',
    value.apifyStatus ? `Статус Apify: ${value.apifyStatus}` : '',
    value.apifyStatusMessage ? `Сообщение Apify: ${value.apifyStatusMessage}` : '',
    value.failureReason ? `Полный текст ошибки: ${value.failureReason}` : '',
    value.externalRunId ? `Прогон Apify: ${value.externalRunId}` : '',
    `Профиль: ${value.profile.name} (${value.profile.actorId})`,
    `Старт: ${formatDate(value.startedAt)}`,
    `Завершение: ${formatDate(value.completedAt)}`,
    `Найдено ${value.foundCount}, импортировано ${value.importedCount}, пропущено ${value.skippedCount}, предупреждений ${value.warningCount}`,
  ].filter(Boolean).join('\n')

  try {
    await navigator.clipboard.writeText(lines)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch {
    toast.error('Буфер обмена недоступен')
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2.5">
      <h3 class="text-base font-semibold">Запуск #{{ runId }}</h3>
      <TrendRunStatusBadge v-if="run" :status="run.status" size="xs" />
      <Icon v-if="isActive" name="mingcute:loading-line" class="animate-spin text-info" />
      <span class="flex-1" />
      <UiButton variant="ghost" aria-label="Закрыть" @click="emit('close')">
        <Icon name="mingcute:close-line" />
      </UiButton>
    </header>

    <UiSkeleton v-if="pending && !run" variant="details" :count="6" class="p-3" />

    <div v-else-if="run" class="flex flex-col gap-3 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-lg font-semibold">{{ headline }}</span>
        <span class="flex-1" />
        <UiButton v-if="isActive" variant="danger" :loading="canceling" @click="confirmCancel = true">
          <Icon v-if="!canceling" name="mingcute:forbid-circle-line" />
          Отменить
        </UiButton>
        <UiButton v-if="canRetryRun" variant="primary" :loading="retrying" @click="handleRetry">
          <Icon v-if="!retrying" name="mingcute:refresh-2-line" />
          Повторить · платно
        </UiButton>
        <UiButton v-if="isTerminal" variant="ghost" @click="copyDiagnostics">
          <Icon :name="copied ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
          {{ copied ? 'Скопировано' : 'Копировать диагностику' }}
        </UiButton>
      </div>

      <p
        v-if="run.errorSummary && run.status !== 'completed'"
        class="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm text-fg"
        :class="run.status === 'canceled'
          ? 'border-warning-border bg-warning-bg'
          : 'border-danger-border bg-danger-bg'"
      >
        <Icon
          :name="run.status === 'canceled' ? 'mingcute:information-line' : 'mingcute:alert-line'"
          class="mt-0.5 shrink-0"
          :class="run.status === 'canceled' ? 'text-warning' : 'text-danger'"
        />
        <span class="min-w-0 flex-1">
          <span class="block font-medium">{{ run.errorSummary }}</span>
          <span v-if="run.errorCategory" class="mt-0.5 block text-micro text-muted">
            {{ ERROR_CATEGORY_LABELS[run.errorCategory] ?? run.errorCategory }}
            <template v-if="run.errorStep">
              · {{ STEP_LABELS[run.errorStep] ?? run.errorStep }}
            </template>
          </span>
        </span>
      </p>

      <p
        v-if="nextAction"
        class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon :name="nextAction.icon" class="mt-0.5 shrink-0 text-info" />
        <span>{{ nextAction.text }}</span>
      </p>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-md border border-border bg-card px-2.5 py-2">
          <span class="block text-micro tracking-[.06em] text-subtle uppercase">Найдено</span>
          <span class="tnum block font-mono text-lg">{{ run.foundCount }}</span>
        </div>
        <div class="rounded-md border border-border bg-card px-2.5 py-2">
          <span class="block text-micro tracking-[.06em] text-subtle uppercase">Импортировано</span>
          <span class="tnum block font-mono text-lg text-success">{{ run.importedCount }}</span>
        </div>
        <div class="rounded-md border border-border bg-card px-2.5 py-2">
          <span class="block text-micro tracking-[.06em] text-subtle uppercase">Пропущено</span>
          <span class="tnum block font-mono text-lg">{{ run.skippedCount }}</span>
        </div>
        <div class="rounded-md border border-border bg-card px-2.5 py-2">
          <span class="block text-micro tracking-[.06em] text-subtle uppercase">Предупреждений</span>
          <span
            class="tnum block font-mono text-lg"
            :class="run.warningCount > 0 && 'text-warning'"
          >{{ run.warningCount }}</span>
        </div>
      </div>

      <div
        v-if="run.apifyStatus || run.apifyStatusMessage"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-2.5 py-2 text-sm text-muted"
      >
        <span v-if="run.apifyStatus" class="inline-flex items-center gap-1.5">
          Статус Apify<span class="font-mono" :class="apifyTone">{{ run.apifyStatus }}</span>
        </span>
        <span v-if="run.apifyStatusMessage" class="min-w-0 flex-1 truncate">
          {{ run.apifyStatusMessage }}
        </span>
      </div>

      <ClientOnly>
        <UiKeyValue :items="infoItems" label-width="128px" />
      </ClientOnly>

      <div v-if="timeline.length" class="flex flex-col gap-1.5">
        <span class="text-micro tracking-[.06em] text-subtle uppercase">Шаги</span>
        <div
          v-for="step in timeline"
          :key="step.step"
          class="flex items-center gap-2.5 rounded-md border border-divider px-2.5 py-1.5"
        >
          <span class="size-1.5 shrink-0 rounded-full" :class="stepTone[step.level] ?? 'bg-neutral'" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ step.label }}</span>
          <span v-if="step.count > 1" class="tnum font-mono text-micro text-subtle">{{ step.count }} записей</span>
          <ClientOnly>
            <span class="tnum font-mono text-micro text-subtle">{{ step.time }}</span>
          </ClientOnly>
        </div>
      </div>

      <UiDisclosure v-if="run.failureReason" title="Полный текст ошибки">
        <pre class="overflow-x-auto rounded-md bg-surface p-2.5 font-mono text-micro break-words whitespace-pre-wrap text-muted">{{ run.failureReason }}</pre>
      </UiDisclosure>

      <div class="flex flex-col gap-1">
        <span class="text-micro tracking-[.06em] text-subtle uppercase">
          Лог запуска · {{ run.logs.length }}
        </span>
        <p v-if="!run.logs.length" class="text-sm text-subtle">Записей пока нет.</p>
        <ClientOnly v-else>
          <div class="max-h-96 overflow-y-auto rounded-md border border-divider p-1">
            <UiLogRow
              v-for="log in run.logs"
              :key="log.id"
              :time="new Date(log.createdAt).toLocaleTimeString('ru-RU')"
              :level="log.level as 'debug' | 'info' | 'warn' | 'error'"
              :message="log.step ? `[${log.step}] ${log.message}` : log.message"
            />
          </div>
        </ClientOnly>
      </div>
    </div>

    <UiModal :open="confirmCancel" size="sm" title="Отменить запуск?" @close="confirmCancel = false">
      <p class="text-sm text-muted">
        Прогон Apify будет остановлен. Уже импортированные тренды останутся в базе,
        а деньги за отработанную часть прогона Apify не возвращает.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmCancel = false">Не отменять</UiButton>
        <UiButton variant="danger" :loading="canceling" @click="handleCancel">Отменить запуск</UiButton>
      </template>
    </UiModal>
  </section>
</template>
