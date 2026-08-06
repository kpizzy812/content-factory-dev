<script setup lang="ts">
/**
 * Здоровье системы. Макет: design-preview/catalog/08-settings-admin.dc.html
 *
 * Две вещи, по которым видно, что завод жив: заняты ли места исполнителя и
 * тикают ли планировщики. Вторая половина важнее первой: очередь может стоять
 * пустой и потому, что делать нечего, и потому, что её никто не разбирает, — и
 * без отметки последнего тика это неотличимо.
 *
 * Значения приходят из памяти процесса, поэтому блок целиком в `ClientOnly`:
 * на сервере он рисовался бы одним состоянием, а через секунду другим.
 */
export interface SchedulerRow {
  key: string
  label: string
  intervalMs: number
  lastTickAt: string | null
  lastError: string | null
  tickCount: number
  errorCount: number
  overdue: boolean
  sinceLastTickMs: number | null
}

export interface SystemHealthData {
  workers: {
    busy: number
    capacity: number
    runningInDb: number
    queuedRuns: number
    runtimeMode: string
    uptimeMs: number
  }
  schedulers: {
    enabled: boolean
    total: number
    overdue: number
    failing: number
    schedulers: SchedulerRow[]
  }
  checkedAt: string
}

const { data, pending, refresh } = useFetch<{ data: SystemHealthData }>('/api/admin/system-health', {
  key: 'admin-system-health',
  server: false,
  lazy: true,
})

const health = computed(() => data.value?.data ?? null)

/** Своё состояние повтора: `pending` на сервере false, а в браузере сразу true. */
const refreshing = ref(false)
async function reload() {
  refreshing.value = true
  try {
    await refresh()
  }
  finally {
    refreshing.value = false
  }
}

function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} с`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} мин`
  return `${Math.round(ms / 3_600_000)} ч`
}

function formatClock(iso: string | null): string {
  if (!iso) return 'тика не было'
  return new Date(iso).toLocaleTimeString('ru-RU')
}

function formatUptime(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч ${minutes % 60} мин`
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`
}

const workerPercent = computed(() => {
  const w = health.value?.workers
  if (!w || w.capacity <= 0) return 0
  return Math.min(100, Math.round((w.busy / w.capacity) * 100))
})
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2 border-b border-divider bg-card px-3.5 py-2.5">
      <h2 class="text-base font-medium">Здоровье системы</h2>
      <span
        v-if="health && (health.schedulers.overdue || !health.schedulers.enabled)"
        class="inline-flex h-5 items-center rounded-sm border border-warning-border bg-warning-bg px-[7px] text-sm text-warning"
      >
        {{ health.schedulers.enabled ? `${health.schedulers.overdue} просрочено` : 'планировщики выключены' }}
      </span>
      <span class="flex-1" />
      <UiButton variant="ghost" :loading="refreshing" @click="reload">
        <Icon v-if="!refreshing" name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
    </header>

    <ClientOnly>
      <UiSkeleton v-if="pending && !health" variant="details" :count="4" class="p-3" />

      <div v-else-if="!health" class="px-3.5 py-3 text-sm text-muted">
        Не удалось получить состояние.
      </div>

      <div v-else class="flex flex-col gap-3 px-3.5 py-3">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span class="flex items-center gap-2">
            <span class="text-sm text-muted">Исполнители</span>
            <span class="tnum font-mono text-lg">
              {{ health.workers.busy }} из {{ health.workers.capacity }}
            </span>
          </span>
          <span class="h-1.5 w-32 overflow-hidden rounded-full bg-card">
            <span class="block h-full bg-info" :style="{ width: `${workerPercent}%` }" />
          </span>
          <span v-if="health.workers.queuedRuns" class="tnum text-sm text-warning">
            в очереди {{ health.workers.queuedRuns }}
          </span>
          <span class="flex-1" />
          <span class="tnum font-mono text-micro text-subtle">
            процесс живёт {{ formatUptime(health.workers.uptimeMs) }}
          </span>
        </div>

        <p
          v-if="health.workers.runningInDb > health.workers.busy"
          class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
        >
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
          <span>
            В базе {{ health.workers.runningInDb }} запусков в статусе «выполняется», а мест занято
            {{ health.workers.busy }}. Так бывает после перезапуска процесса — лишние подберёт
            восстановление, но если число не падает, запуски зависли.
          </span>
        </p>

        <div v-if="!health.schedulers.enabled" class="text-sm text-muted">
          Планировщики выключены переменной <span class="font-mono">SCHEDULERS_ENABLED=false</span>:
          расписания не срабатывают, очередь публикаций не разбирается.
        </div>

        <div v-else class="flex flex-col gap-1">
          <span class="text-micro tracking-[.06em] text-subtle uppercase">
            Планировщики · {{ health.schedulers.total }}
          </span>
          <div
            v-for="row in health.schedulers.schedulers"
            :key="row.key"
            class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 rounded-md border px-2.5 py-1.5"
            :class="row.overdue ? 'border-warning-border bg-warning-bg' : 'border-divider'"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="row.lastError ? 'bg-danger' : row.overdue ? 'bg-warning' : row.lastTickAt ? 'bg-success' : 'bg-neutral'"
              />
              <span class="truncate text-sm">{{ row.label }}</span>
            </span>
            <span class="tnum font-mono text-micro text-subtle">раз в {{ formatInterval(row.intervalMs) }}</span>
            <span class="tnum font-mono text-sm" :class="row.overdue ? 'text-warning' : 'text-muted'">
              {{ formatClock(row.lastTickAt) }}
            </span>
            <p v-if="row.lastError" class="col-span-3 text-sm text-danger">{{ row.lastError }}</p>
          </div>
        </div>
      </div>

      <template #fallback>
        <UiSkeleton variant="details" :count="4" class="p-3" />
      </template>
    </ClientOnly>
  </section>
</template>
