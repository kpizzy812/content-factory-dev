<script setup lang="ts">
definePageMeta({
  middleware: ['admin-access'],
})

const route = useRoute()
const cycleId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useFetch(`/api/admin/cycles/${cycleId.value}`, {
  key: `admin-cycle-${cycleId.value}`,
})

const cycle = computed(() => (data.value as any)?.data ?? null)

useHead({
  title: computed(() => cycle.value ? `Цикл #${cycle.value.id}` : 'Цикл'),
})

const statusConfig: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Ожидание', badge: 'badge-ghost' },
  running: { label: 'Работает', badge: 'badge-info' },
  completed: { label: 'Завершён', badge: 'badge-success' },
  failed: { label: 'Ошибка', badge: 'badge-error' },
  stopped: { label: 'Остановлен', badge: 'badge-warning' },
}

const canStop = computed(() => {
  return cycle.value && (cycle.value.status === 'running' || cycle.value.status === 'pending')
})

const stopping = ref(false)
const stopError = ref('')

async function handleStop() {
  stopping.value = true
  stopError.value = ''
  try {
    await $fetch(`/api/admin/cycles/${cycleId.value}/stop`, { method: 'POST' })
    await refresh()
  } catch (e: any) {
    stopError.value = e?.data?.message || 'Не удалось остановить цикл'
  } finally {
    stopping.value = false
  }
}

const levelConfig: Record<string, { label: string; badge: string }> = {
  info: { label: 'Инфо', badge: 'badge-info' },
  warn: { label: 'Внимание', badge: 'badge-warning' },
  error: { label: 'Ошибка', badge: 'badge-error' },
}

const moduleLabels: Record<string, string> = {
  trendwatcher: 'Трендвотчер',
  'script-generator': 'Сценарии',
  'video-generator': 'Видео',
  'social-upload': 'Загрузка',
  analytics: 'Аналитика',
  orchestrator: 'Оркестратор',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(start: string, end: string | null): string {
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const diff = Math.round((e - s) / 1000)
  if (diff < 60) return `${diff} сек`
  if (diff < 3600) return `${Math.floor(diff / 60)} мин ${diff % 60} сек`
  return `${Math.floor(diff / 3600)} ч ${Math.floor((diff % 3600) / 60)} мин`
}
</script>

<template>
  <div class="space-y-4">
    <!-- Навигация -->
    <div class="text-sm breadcrumbs">
      <ul>
        <li><NuxtLink to="/admin">Админ</NuxtLink></li>
        <li><NuxtLink to="/admin/cycles">Циклы</NuxtLink></li>
        <li v-if="cycle">Цикл #{{ cycle.id }}</li>
      </ul>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ (error as any)?.message }}</span>
    </div>

    <!-- Content -->
    <template v-else-if="cycle">
      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-bold text-base-content">Цикл #{{ cycle.id }}</h1>
          <span :class="['badge', statusConfig[cycle.status]?.badge ?? 'badge-ghost']">
            {{ statusConfig[cycle.status]?.label ?? cycle.status }}
          </span>
        </div>
        <button
          v-if="canStop"
          class="btn btn-warning btn-sm gap-1"
          :disabled="stopping"
          @click="handleStop"
        >
          <span v-if="stopping" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:stop-circle-line" />
          Остановить
        </button>
      </div>

      <div v-if="stopError" role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ stopError }}</span>
      </div>

      <!-- Info cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Details -->
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4 gap-3">
            <h3 class="card-title text-sm">Информация</h3>
            <div class="grid grid-cols-2 gap-y-2 text-sm">
              <span class="text-base-content/60">Приложение</span>
              <NuxtLink
                v-if="cycle.app"
                :to="`/admin/apps/${cycle.app.id}`"
                class="link link-primary"
              >
                {{ cycle.app.name }}
              </NuxtLink>
              <span v-else>—</span>

              <span class="text-base-content/60">Группа аккаунтов</span>
              <span>{{ cycle.accountGroup?.name ?? '—' }}</span>

              <span class="text-base-content/60">Запущен</span>
              <span>{{ cycle.startedAt ? formatDate(cycle.startedAt) : '—' }}</span>

              <span class="text-base-content/60">Завершён</span>
              <span>{{ cycle.completedAt ? formatDate(cycle.completedAt) : '—' }}</span>

              <span class="text-base-content/60">Длительность</span>
              <span>{{ cycle.startedAt ? formatDuration(cycle.startedAt, cycle.completedAt) : '—' }}</span>
            </div>

            <div v-if="cycle.errorMessage" role="alert" class="alert alert-error alert-soft text-sm mt-2">
              <Icon name="mingcute:warning-line" />
              <span>{{ cycle.errorMessage }}</span>
            </div>
          </div>
        </div>

        <!-- Metrics -->
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4 gap-3">
            <h3 class="card-title text-sm">Результаты</h3>
            <div class="grid grid-cols-2 gap-3">
              <div class="text-center p-3 rounded-lg bg-base-200/50">
                <div class="text-2xl font-bold text-base-content">{{ cycle.trendsFound }}</div>
                <div class="text-xs text-base-content/60">Тренды</div>
              </div>
              <div class="text-center p-3 rounded-lg bg-base-200/50">
                <div class="text-2xl font-bold text-base-content">{{ cycle.scenariosGen }}</div>
                <div class="text-xs text-base-content/60">Сценарии</div>
              </div>
              <div class="text-center p-3 rounded-lg bg-base-200/50">
                <div class="text-2xl font-bold text-base-content">{{ cycle.videosGen }}</div>
                <div class="text-xs text-base-content/60">Видео</div>
              </div>
              <div class="text-center p-3 rounded-lg bg-base-200/50">
                <div class="text-2xl font-bold text-base-content">{{ cycle.uploadsCount }}</div>
                <div class="text-xs text-base-content/60">Загрузки</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Logs -->
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4 gap-3">
          <div class="flex items-center justify-between">
            <h3 class="card-title text-sm">
              <Icon name="mingcute:file-line" />
              Логи цикла
            </h3>
            <span class="badge badge-sm badge-ghost">{{ cycle.logs?.length ?? 0 }}</span>
          </div>

          <div v-if="cycle.logs?.length" class="space-y-1 max-h-96 overflow-y-auto">
            <div
              v-for="log in cycle.logs"
              :key="log.id"
              class="flex items-start gap-2 p-2 rounded text-sm hover:bg-base-200/50"
            >
              <span :class="['badge badge-xs shrink-0 mt-1', levelConfig[log.level]?.badge ?? 'badge-ghost']">
                {{ levelConfig[log.level]?.label ?? log.level }}
              </span>
              <span class="text-xs text-base-content/50 shrink-0 w-20">
                {{ moduleLabels[log.module] ?? log.module }}
              </span>
              <span class="flex-1 text-base-content break-words">{{ log.message }}</span>
              <span class="text-xs text-base-content/40 shrink-0">
                {{ formatDate(log.createdAt) }}
              </span>
            </div>
          </div>

          <div v-else class="text-center py-6 text-base-content/40">
            <Icon name="mingcute:document-line" class="text-3xl mb-2" />
            <p class="text-sm">Логов пока нет</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
