<script setup lang="ts">
import type { EntityStatus } from '~~/shared/utils/entity-status'

definePageMeta({ middleware: ['admin-access'] })

const route = useRoute()
const cycleId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useFetch(`/api/admin/cycles/${cycleId.value}`, {
  key: `admin-cycle-${cycleId.value}`,
})

const cycle = computed(() => (data.value as { data?: Record<string, any> } | null)?.data ?? null)

useHead({ title: computed(() => cycle.value ? `Цикл #${cycle.value.id} — цикл` : 'Цикл') })

/** Статусы цикла в общем словаре системы. */
const CYCLE_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  pending: 'queued',
  running: 'running',
  completed: 'done',
  failed: 'failed',
  stopped: 'cancelled',
}

const CYCLE_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает',
  running: 'Работает',
  completed: 'Завершён',
  failed: 'Упал',
  stopped: 'Остановлен',
}

const canStop = computed(() =>
  cycle.value && (cycle.value.status === 'running' || cycle.value.status === 'pending'))

const stopping = ref(false)
const stopError = ref('')

async function handleStop() {
  stopping.value = true
  stopError.value = ''
  try {
    await $fetch(`/api/admin/cycles/${cycleId.value}/stop`, { method: 'POST' })
    await refresh()
  }
  catch (e) {
    stopError.value = (e as { data?: { message?: string } })?.data?.message || 'Не удалось остановить цикл'
  }
  finally {
    stopping.value = false
  }
}

const MODULE_LABELS: Record<string, string> = {
  trendwatcher: 'Трендвотчер',
  'script-generator': 'Сценарии',
  'video-generator': 'Видео',
  'social-upload': 'Публикации',
  analytics: 'Аналитика',
  orchestrator: 'Оркестратор',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDuration(start: string, end: string | null): string {
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const diff = Math.round((e - s) / 1000)
  if (diff < 60) return `${diff} с`
  if (diff < 3600) return `${Math.floor(diff / 60)} мин ${diff % 60} с`
  return `${Math.floor(diff / 3600)} ч ${Math.floor((diff % 3600) / 60)} мин`
}

const info = computed(() => {
  const c = cycle.value
  if (!c) return []
  return [
    { label: 'Приложение', value: c.app?.name ?? null, to: c.app ? `/admin/apps/${c.app.id}` : undefined, mono: false },
    { label: 'Группа аккаунтов', value: c.accountGroup?.name ?? null, mono: false },
    { label: 'Запущен', value: c.startedAt ? formatDate(c.startedAt) : null },
    { label: 'Завершён', value: c.completedAt ? formatDate(c.completedAt) : null },
    { label: 'Длительность', value: c.startedAt ? formatDuration(c.startedAt, c.completedAt) : null },
  ]
})

const results = computed(() => {
  const c = cycle.value
  if (!c) return []
  return [
    { label: 'Тренды', value: c.trendsFound },
    { label: 'Сценарии', value: c.scenariosGen },
    { label: 'Ролики', value: c.videosGen },
    { label: 'Публикации', value: c.uploadsCount },
  ]
})

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
function logLevel(raw: string): LogLevel {
  return (['debug', 'info', 'warn', 'error'] as const).includes(raw as LogLevel) ? raw as LogLevel : 'info'
}
</script>

<template>
  <div>
    <UiSkeleton v-if="pending && !cycle" variant="details" :count="5" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить цикл"
      :message="(error as { message?: string })?.message"
      @retry="refresh"
    />

    <template v-else-if="cycle">
      <DetailHeader
        :title="`Цикл #${cycle.id}`"
        back-to="/admin/cycles"
        back-label="К циклам"
      >
        <template #badges>
          <UiStatusBadge
            :status="CYCLE_STATUS_TO_ENTITY[cycle.status] ?? 'draft'"
            :title="CYCLE_STATUS_LABELS[cycle.status] ?? cycle.status"
          />
        </template>

        <template #actions>
          <UiButton v-if="canStop" variant="danger" :loading="stopping" @click="handleStop">
            <Icon v-if="!stopping" name="mingcute:stop-circle-line" />
            Остановить
          </UiButton>
        </template>
      </DetailHeader>

      <div class="flex flex-col gap-3">
        <div
          v-if="stopError"
          role="alert"
          class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
        >
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
          <span>{{ stopError }}</span>
        </div>

        <div class="grid items-start gap-3.5 md:grid-cols-2">
          <section class="rounded-lg border border-border bg-panel p-3.5">
            <h2 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Информация</h2>
            <UiKeyValue :items="info" label-width="140px" />

            <div
              v-if="cycle.errorMessage"
              role="alert"
              class="mt-2.5 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
            >
              <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
              <span>{{ cycle.errorMessage }}</span>
            </div>
          </section>

          <section class="rounded-lg border border-border bg-panel p-3.5">
            <h2 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Что сделано</h2>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div v-for="r in results" :key="r.label">
                <div class="text-[11.5px] text-muted">{{ r.label }}</div>
                <div class="tnum font-mono text-2xl font-semibold">{{ r.value ?? 0 }}</div>
              </div>
            </div>
          </section>
        </div>

        <section class="rounded-lg border border-border bg-panel p-3.5">
          <div class="mb-2 flex items-center gap-2">
            <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Логи цикла</h2>
            <span class="tnum font-mono text-micro text-subtle">{{ cycle.logs?.length ?? 0 }}</span>
          </div>

          <div v-if="cycle.logs?.length" class="max-h-96 overflow-y-auto">
            <UiLogRow
              v-for="log in cycle.logs"
              :key="log.id"
              :time="formatTime(log.createdAt)"
              :level="logLevel(log.level)"
              :message="`${MODULE_LABELS[log.module] ?? log.module} · ${log.message}`"
            />
          </div>

          <UiEmptyState v-else title="Логов нет" description="Цикл ещё ничего не записал." />
        </section>
      </div>
    </template>
  </div>
</template>
