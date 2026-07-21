<script setup lang="ts">
const props = defineProps<{
  runId: number
}>()

const emit = defineEmits<{
  close: []
  showDetail: [runId: number]
}>()

const runIdRef = computed(() => props.runId)
const { run, pending, isActive, cancelRun, retryRun } = useTrendwatcherRunDetail(runIdRef as Ref<number | null>)

const canceling = ref(false)
const retrying = ref(false)
const showRawDiagnostics = ref(false)
const copySuccess = ref(false)

const statusLabels: Record<string, string> = {
  pending: 'Ожидание запуска',
  starting: 'Запускается...',
  running: 'Apify выполняет парсинг...',
  importing: 'Импорт трендов в базу...',
  analyzing: 'AI-анализ трендов...',
  completed: 'Успешно завершён',
  failed: 'Завершился с ошибкой',
  canceled: 'Отменён оператором',
  partially_completed: 'Частично завершён',
}

const statusColors: Record<string, string> = {
  pending: 'text-warning',
  starting: 'text-warning',
  running: 'text-info',
  importing: 'text-info',
  analyzing: 'text-info',
  completed: 'text-success',
  failed: 'text-error',
  canceled: 'text-base-content/50',
  partially_completed: 'text-warning',
}

const logLevelColors: Record<string, string> = {
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-error',
}

const errorCategoryLabels: Record<string, string> = {
  profile_validation_error: 'Ошибка профиля',
  apify_start_failed: 'Apify не запустился',
  apify_run_failed: 'Apify run упал',
  apify_timeout: 'Таймаут Apify',
  dataset_empty: 'Пустой dataset',
  import_failed: 'Ошибка импорта',
  import_partial_failure: 'Частичный импорт',
  canceled: 'Отменён',
  watchdog_failed: 'Watchdog таймаут',
  unknown_external_error: 'Неизвестная ошибка',
}

const stepLabels: Record<string, string> = {
  init: 'Инициализация',
  starting: 'Запуск актора',
  running: 'Выполнение Apify',
  importing: 'Импорт данных',
  completed: 'Завершение',
  canceled: 'Отмена',
  unknown: 'Неизвестный шаг',
  watchdog: 'Watchdog',
}

const isTerminal = computed(() => {
  if (!run.value) return false
  return ['failed', 'canceled', 'partially_completed', 'completed'].includes(run.value.status)
})

const canRetryRun = computed(() => {
  if (!run.value) return false
  return ['failed', 'canceled', 'partially_completed'].includes(run.value.status) && run.value.canRetry
})

const nextActionHint = computed(() => {
  if (!run.value) return null
  if (run.value.status === 'completed') return null
  if (run.value.needsProfileFix) return { text: 'Исправьте настройки профиля и запустите снова', icon: 'mingcute:settings-2-line' }
  if (run.value.canRetry) return { text: 'Можно повторить запуск', icon: 'mingcute:refresh-2-line' }
  return null
})

/** Timeline шагов */
const timeline = computed(() => {
  if (!run.value?.logs?.length) return []
  const steps: Array<{ step: string; label: string; level: string; time: string; messages: string[] }> = []
  const seen = new Map<string, typeof steps[0]>()

  for (const log of run.value.logs) {
    const step = log.step || 'unknown'
    if (!seen.has(step)) {
      const entry = {
        step,
        label: stepLabels[step] || step,
        level: log.level,
        time: new Date(log.createdAt).toLocaleTimeString('ru-RU'),
        messages: [log.message],
      }
      seen.set(step, entry)
      steps.push(entry)
    } else {
      const entry = seen.get(step)!
      entry.messages.push(log.message)
      // Upgrade level: info < warn < error
      if (log.level === 'error') entry.level = 'error'
      else if (log.level === 'warn' && entry.level !== 'error') entry.level = 'warn'
    }
  }
  return steps
})

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'в процессе...'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}мс`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}с`
  return `${Math.floor(sec / 60)}м ${sec % 60}с`
}

async function handleCancel() {
  if (!confirm('Отменить запуск?')) return
  canceling.value = true
  try {
    await cancelRun()
  } finally {
    canceling.value = false
  }
}

async function handleRetry() {
  retrying.value = true
  try {
    const result = await retryRun()
    if (result?.runId) {
      emit('showDetail', result.runId)
    }
  } finally {
    retrying.value = false
  }
}

async function copyDiagnostics() {
  if (!run.value) return
  const lines = [
    `Запуск #${run.value.id}`,
    `Статус: ${run.value.status}`,
    run.value.errorSummary ? `Ошибка: ${run.value.errorSummary}` : '',
    run.value.errorCategory ? `Категория: ${run.value.errorCategory}` : '',
    run.value.errorStep ? `Шаг: ${run.value.errorStep}` : '',
    run.value.apifyStatus ? `Apify статус: ${run.value.apifyStatus}` : '',
    run.value.apifyStatusMessage ? `Apify сообщение: ${run.value.apifyStatusMessage}` : '',
    run.value.failureReason ? `Raw error: ${run.value.failureReason}` : '',
    run.value.externalRunId ? `Apify Run ID: ${run.value.externalRunId}` : '',
    `Профиль: ${run.value.profile.name} (${run.value.profile.actorId})`,
    `Старт: ${formatDate(run.value.startedAt)}`,
    `Завершение: ${formatDate(run.value.completedAt)}`,
    `Found: ${run.value.foundCount}, Imported: ${run.value.importedCount}, Skipped: ${run.value.skippedCount}, Warnings: ${run.value.warningCount}`,
  ].filter(Boolean).join('\n')

  await navigator.clipboard.writeText(lines)
  copySuccess.value = true
  setTimeout(() => { copySuccess.value = false }, 2000)
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4">
      <!-- Header -->
      <div class="flex items-center justify-between mb-3">
        <h3 class="card-title text-lg">
          <Icon name="mingcute:file-info-line" class="text-lg" />
          Запуск #{{ runId }}
          <span v-if="isActive" class="loading loading-ring loading-sm text-primary" />
        </h3>
        <button class="btn btn-ghost btn-sm btn-square" @click="emit('close')">
          <Icon name="mingcute:close-line" class="text-lg" />
        </button>
      </div>

      <!-- Loading -->
      <div v-if="pending && !run" class="flex justify-center py-8">
        <span class="loading loading-spinner loading-md" />
      </div>

      <template v-else-if="run">
        <!-- Status header + actions -->
        <div class="flex items-center gap-3 mb-4 flex-wrap">
          <div class="text-2xl font-bold" :class="statusColors[run.status]">
            {{ statusLabels[run.status] ?? run.status }}
          </div>
          <button
            v-if="isActive"
            class="btn btn-error btn-sm"
            :disabled="canceling"
            @click="handleCancel"
          >
            <span v-if="canceling" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:stop-circle-line" class="text-sm" />
            Отменить
          </button>
          <button
            v-if="canRetryRun"
            class="btn btn-primary btn-sm"
            :disabled="retrying"
            @click="handleRetry"
          >
            <span v-if="retrying" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:refresh-2-line" class="text-sm" />
            Повторить запуск
          </button>
          <button
            v-if="isTerminal"
            class="btn btn-ghost btn-sm"
            :class="{ 'btn-success': copySuccess }"
            @click="copyDiagnostics"
          >
            <Icon :name="copySuccess ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-sm" />
            {{ copySuccess ? 'Скопировано' : 'Копировать диагностику' }}
          </button>
        </div>

        <!-- Error Summary (human-readable) -->
        <div v-if="run.errorSummary && run.status !== 'completed'" role="alert" class="alert mb-4" :class="run.status === 'canceled' ? 'alert-warning' : 'alert-error'">
          <Icon :name="run.status === 'canceled' ? 'mingcute:information-line' : 'mingcute:warning-line'" />
          <div>
            <div class="font-semibold">{{ run.errorSummary }}</div>
            <div v-if="run.errorCategory" class="text-xs mt-1 opacity-70">
              Категория: {{ errorCategoryLabels[run.errorCategory] ?? run.errorCategory }}
              <span v-if="run.errorStep"> · Шаг: {{ stepLabels[run.errorStep] ?? run.errorStep }}</span>
            </div>
          </div>
        </div>

        <!-- Next action hint -->
        <div v-if="nextActionHint" class="alert alert-info mb-4">
          <Icon :name="nextActionHint.icon" />
          <span>{{ nextActionHint.text }}</span>
        </div>

        <!-- Apify external info -->
        <div v-if="run.apifyStatus || run.apifyStatusMessage" class="bg-base-200 rounded-lg p-3 mb-4">
          <h4 class="font-semibold text-xs mb-1 text-base-content/60">Apify диагностика</h4>
          <div class="text-sm space-y-1">
            <div v-if="run.apifyStatus">
              <span class="text-base-content/50">Статус Apify:</span>
              <span class="font-mono ml-1" :class="{
                'text-success': run.apifyStatus === 'SUCCEEDED',
                'text-error': ['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.apifyStatus),
                'text-info': ['RUNNING', 'READY'].includes(run.apifyStatus),
              }">{{ run.apifyStatus }}</span>
            </div>
            <div v-if="run.apifyStatusMessage">
              <span class="text-base-content/50">Сообщение:</span>
              <span class="ml-1">{{ run.apifyStatusMessage }}</span>
            </div>
          </div>
        </div>

        <!-- Stats grid -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div class="stat bg-base-200 rounded-lg p-3">
            <div class="stat-title text-xs">Найдено</div>
            <div class="stat-value text-lg">{{ run.foundCount }}</div>
          </div>
          <div class="stat bg-base-200 rounded-lg p-3">
            <div class="stat-title text-xs">Импортировано</div>
            <div class="stat-value text-lg text-success">{{ run.importedCount }}</div>
          </div>
          <div class="stat bg-base-200 rounded-lg p-3">
            <div class="stat-title text-xs">Пропущено</div>
            <div class="stat-value text-lg">{{ run.skippedCount }}</div>
          </div>
          <div class="stat bg-base-200 rounded-lg p-3">
            <div class="stat-title text-xs">Warnings</div>
            <div class="stat-value text-lg" :class="{ 'text-warning': run.warningCount > 0 }">
              {{ run.warningCount }}
            </div>
          </div>
        </div>

        <!-- Info -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-4">
          <div><span class="text-base-content/50">Профиль:</span> {{ run.profile.name }}</div>
          <div><span class="text-base-content/50">Актор:</span> {{ run.profile.actorId }}</div>
          <div><span class="text-base-content/50">Тип запуска:</span> {{ run.triggerType }}</div>
          <div><span class="text-base-content/50">Инициатор:</span> {{ run.initiatedBy ?? '—' }}</div>
          <div><span class="text-base-content/50">Старт:</span> {{ formatDate(run.startedAt) }}</div>
          <div><span class="text-base-content/50">Завершение:</span> {{ formatDate(run.completedAt) }}</div>
          <div><span class="text-base-content/50">Длительность:</span> {{ formatDuration(run.startedAt, run.completedAt) }}</div>
          <div v-if="run.externalRunId">
            <span class="text-base-content/50">Apify Run:</span>
            <span class="font-mono text-xs ml-1">{{ run.externalRunId }}</span>
          </div>
        </div>

        <!-- Timeline -->
        <div v-if="timeline.length > 0" class="mb-4">
          <h4 class="font-semibold text-sm mb-2">
            <Icon name="mingcute:time-line" class="text-sm" />
            Timeline шагов
          </h4>
          <ul class="steps steps-vertical text-sm">
            <li
              v-for="(step, idx) in timeline"
              :key="idx"
              class="step"
              :class="{
                'step-success': step.level === 'info' && run.status === 'completed',
                'step-info': step.level === 'info' && run.status !== 'completed',
                'step-warning': step.level === 'warn',
                'step-error': step.level === 'error',
              }"
            >
              <div class="text-left">
                <span class="font-medium">{{ step.label }}</span>
                <span class="text-xs text-base-content/40 ml-1">{{ step.time }}</span>
              </div>
            </li>
          </ul>
        </div>

        <!-- Raw diagnostics (collapsible) -->
        <div v-if="run.failureReason" class="mb-4">
          <button
            class="btn btn-ghost btn-xs"
            @click="showRawDiagnostics = !showRawDiagnostics"
          >
            <Icon :name="showRawDiagnostics ? 'mingcute:up-line' : 'mingcute:down-line'" class="text-sm" />
            Raw diagnostics
          </button>
          <div v-if="showRawDiagnostics" class="mt-2 bg-base-200 rounded-lg p-3">
            <pre class="text-xs font-mono whitespace-pre-wrap break-all text-base-content/70">{{ run.failureReason }}</pre>
          </div>
        </div>

        <!-- Logs -->
        <div class="mb-2">
          <h4 class="font-semibold text-sm mb-2">
            <Icon name="mingcute:list-check-line" class="text-sm" />
            Лог запуска ({{ run.logs.length }})
          </h4>

          <div v-if="run.logs.length === 0" class="text-sm text-base-content/40 italic">
            Логов пока нет
          </div>

          <div v-else class="max-h-96 overflow-y-auto bg-base-200 rounded-lg p-2 space-y-1">
            <div
              v-for="log in run.logs"
              :key="log.id"
              class="flex items-start gap-2 text-xs font-mono"
            >
              <span class="text-base-content/40 min-w-16 shrink-0">
                {{ new Date(log.createdAt).toLocaleTimeString('ru-RU') }}
              </span>
              <span
                class="uppercase font-bold min-w-10 shrink-0"
                :class="logLevelColors[log.level] ?? 'text-base-content/50'"
              >
                {{ log.level }}
              </span>
              <span v-if="log.step" class="badge badge-ghost badge-xs shrink-0">
                {{ log.step }}
              </span>
              <span class="text-base-content/80 break-all">
                {{ log.message }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
