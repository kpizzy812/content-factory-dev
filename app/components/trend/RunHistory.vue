<script setup lang="ts">
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

const statusLabels: Record<string, string> = {
  pending: 'Ожидание',
  starting: 'Запуск',
  running: 'Выполняется',
  importing: 'Импорт',
  analyzing: 'Анализ',
  completed: 'Завершён',
  failed: 'Ошибка',
  canceled: 'Отменён',
  partially_completed: 'Частично',
}

const statusColors: Record<string, string> = {
  pending: 'badge-warning',
  starting: 'badge-warning',
  running: 'badge-info',
  importing: 'badge-info',
  analyzing: 'badge-info',
  completed: 'badge-success',
  failed: 'badge-error',
  canceled: 'badge-neutral',
  partially_completed: 'badge-warning',
}

const triggerLabels: Record<string, string> = {
  manual: 'Ручной',
  scheduled: 'По расписанию',
  pipeline: 'Конвейер',
}

const stepLabels: Record<string, string> = {
  init: 'иниц.',
  starting: 'запуск',
  running: 'Apify',
  importing: 'импорт',
  completed: 'заверш.',
  canceled: 'отмена',
  unknown: '?',
  watchdog: 'watchdog',
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '...'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}мс`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}с`
  return `${Math.floor(sec / 60)}м ${sec % 60}с`
}

/** Краткое описание результата для таблицы */
function getResultSummary(run: typeof runs.value[0]) {
  if (run.importedCount > 0) {
    return { text: `+${run.importedCount}`, class: 'text-success font-medium' }
  }
  if (run.status === 'completed') {
    return { text: '0', class: 'text-base-content/40' }
  }
  if (run.errorSummary) {
    return { text: run.errorSummary, class: 'text-error' }
  }
  if (run.failureReason) {
    return { text: run.failureReason, class: 'text-error' }
  }
  return null
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="card-title text-lg">
          <Icon name="mingcute:history-line" class="text-lg" />
          История запусков
          <span v-if="profileName" class="text-sm font-normal text-base-content/60">
            — {{ profileName }}
          </span>
        </h3>
        <button class="btn btn-ghost btn-sm btn-square" @click="emit('close')">
          <Icon name="mingcute:close-line" class="text-lg" />
        </button>
      </div>

      <!-- Loading -->
      <div v-if="pending" class="flex justify-center py-8">
        <span class="loading loading-spinner loading-md" />
      </div>

      <!-- Empty -->
      <div v-else-if="runs.length === 0" class="text-center py-8 text-base-content/50">
        <Icon name="mingcute:inbox-line" class="text-3xl mb-2" />
        <p>Запусков пока нет</p>
      </div>

      <!-- Runs table -->
      <div v-else class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Статус</th>
              <th>Тип</th>
              <th>Старт</th>
              <th>Длительность</th>
              <th>Шаг</th>
              <th>Результат</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="run in runs"
              :key="run.id"
              class="hover cursor-pointer"
              @click="emit('showDetail', run.id)"
            >
              <td class="font-mono text-xs">
                {{ run.id }}
              </td>
              <td>
                <span class="badge badge-sm" :class="statusColors[run.status] ?? 'badge-neutral'">
                  {{ statusLabels[run.status] ?? run.status }}
                </span>
              </td>
              <td class="text-xs text-base-content/60">
                {{ triggerLabels[run.triggerType] ?? run.triggerType }}
              </td>
              <td class="text-xs">
                {{ formatDate(run.startedAt) }}
              </td>
              <td class="text-xs">
                {{ formatDuration(run.startedAt, run.completedAt) }}
              </td>
              <td class="text-xs">
                <span v-if="run.errorStep" class="badge badge-ghost badge-xs">
                  {{ stepLabels[run.errorStep] ?? run.errorStep }}
                </span>
              </td>
              <td class="text-xs max-w-48">
                <template v-if="getResultSummary(run)">
                  <span :class="getResultSummary(run)!.class" class="truncate block max-w-48" :title="getResultSummary(run)!.text">
                    {{ getResultSummary(run)!.text }}
                  </span>
                </template>
              </td>
              <td>
                <div class="flex items-center gap-1">
                  <Icon v-if="run.canRetry && run.status === 'failed'" name="mingcute:refresh-2-line" class="text-sm text-primary" title="Можно повторить" />
                  <Icon v-if="run.needsProfileFix" name="mingcute:settings-2-line" class="text-sm text-warning" title="Нужен фикс профиля" />
                  <button class="btn btn-ghost btn-xs">
                    <Icon name="mingcute:right-line" class="text-sm" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="meta.totalPages > 1" class="flex justify-center mt-3">
        <div class="join">
          <button
            class="join-item btn btn-sm"
            :disabled="page <= 1"
            @click="page--"
          >
            <Icon name="mingcute:left-line" />
          </button>
          <button class="join-item btn btn-sm btn-disabled">
            {{ page }} / {{ meta.totalPages }}
          </button>
          <button
            class="join-item btn btn-sm"
            :disabled="page >= meta.totalPages"
            @click="page++"
          >
            <Icon name="mingcute:right-line" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
