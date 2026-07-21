<script setup lang="ts">
const props = defineProps<{
  profile: {
    id: number
    appId: number
    app: { id: number; name: string }
    name: string
    actorId: string
    keywords: string[]
    platforms: string[]
    language: string | null
    geo: string | null
    viewCountMin: number | null
    viewCountMax: number | null
    maxItems: number
    enabled: boolean
    scheduleEnabled: boolean
    scheduleCron: string | null
    scheduleNextRunAt: string | null
    lastSuccessfulRunAt: string | null
    validationStatus: string | null
    validationSummary: string | null
    validatedAt: string | null
    hasActiveRun: boolean
    activeRunId: number | null
    lastRun: {
      id: number
      status: string
      startedAt: string
      completedAt: string | null
      foundCount: number
      importedCount: number
      failureReason: string | null
      triggerType: string
    } | null
  }
  isRunning?: boolean
}>()

const emit = defineEmits<{
  toggle: [id: number, enabled: boolean]
  run: [id: number]
  edit: [id: number]
  delete: [id: number]
  duplicate: [id: number]
  schedule: [id: number]
  showRuns: [id: number]
  showRunDetail: [runId: number]
  validate: [id: number]
}>()

const platformLabels: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
}

const platformColors: Record<string, string> = {
  tiktok: 'badge-primary',
  instagram: 'badge-secondary',
  youtube: 'badge-error',
}

const runStatusLabels: Record<string, string> = {
  pending: 'Ожидание...',
  starting: 'Запускается...',
  running: 'Apify работает...',
  importing: 'Импорт трендов...',
  analyzing: 'Анализ...',
  completed: 'Завершён',
  failed: 'Ошибка',
  canceled: 'Отменён',
  partially_completed: 'Частично',
}

const runStatusColors: Record<string, string> = {
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

const isActive = computed(() => props.profile.hasActiveRun || props.isRunning)
const showActiveIndicator = computed(() => isActive.value)

const validationBadge = computed(() => {
  const status = props.profile.validationStatus
  if (!status) return { label: 'Не проверен', color: 'badge-ghost', icon: 'mingcute:question-line' }
  if (status === 'valid') return { label: 'Конфиг OK', color: 'badge-success', icon: 'mingcute:check-circle-line' }
  return { label: 'Ошибка конфига', color: 'badge-error', icon: 'mingcute:warning-line' }
})

const hasConfigError = computed(() => {
  const status = props.profile.validationStatus
  return status && status !== 'valid'
})

const canLaunch = computed(() => {
  return props.profile.enabled && !isActive.value && !hasConfigError.value
})

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div
    class="card bg-base-100 shadow-sm border"
    :class="{
      'opacity-50': !profile.enabled,
      'border-primary/30': showActiveIndicator,
      'border-base-300': !showActiveIndicator,
    }"
  >
    <div class="card-body p-4 gap-3">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="font-semibold text-base-content truncate">
              {{ profile.name }}
            </h3>
            <!-- Active run indicator -->
            <span v-if="showActiveIndicator" class="loading loading-ring loading-xs text-primary" />
          </div>
          <p class="text-xs text-base-content/50 mt-0.5">
            {{ profile.app.name }} &middot; {{ profile.actorId }}
            <span
              class="badge badge-xs ml-1"
              :class="validationBadge.color"
              :title="profile.validationSummary ?? validationBadge.label"
            >
              <Icon :name="validationBadge.icon" class="text-[10px]" />
              {{ validationBadge.label }}
            </span>
          </p>
        </div>
        <input
          type="checkbox"
          class="toggle toggle-sm toggle-primary"
          :checked="profile.enabled"
          @change="emit('toggle', profile.id, !profile.enabled)"
        >
      </div>

      <!-- Keywords -->
      <div v-if="profile.keywords.length > 0" class="flex flex-wrap gap-1">
        <span
          v-for="kw in profile.keywords.slice(0, 6)"
          :key="kw"
          class="badge badge-ghost badge-sm"
        >
          {{ kw }}
        </span>
        <span v-if="profile.keywords.length > 6" class="badge badge-ghost badge-sm">
          +{{ profile.keywords.length - 6 }}
        </span>
      </div>
      <p v-else class="text-xs text-base-content/40 italic">
        Нет ключевых слов
      </p>

      <!-- Platforms + filters -->
      <div class="flex flex-wrap gap-1">
        <span
          v-for="p in profile.platforms"
          :key="p"
          class="badge badge-sm"
          :class="platformColors[p] ?? 'badge-neutral'"
        >
          {{ platformLabels[p] ?? p }}
        </span>
        <span v-if="profile.language" class="badge badge-outline badge-sm">
          {{ profile.language }}
        </span>
        <span v-if="profile.geo" class="badge badge-outline badge-sm">
          {{ profile.geo }}
        </span>
        <span v-if="profile.viewCountMin || profile.viewCountMax" class="badge badge-outline badge-sm">
          {{ profile.viewCountMin ?? 0 }}–{{ profile.viewCountMax ?? '∞' }} views
        </span>
      </div>

      <!-- Config error alert -->
      <div v-if="hasConfigError" class="flex items-start gap-2 p-2 rounded-lg bg-error/10 text-error text-xs">
        <Icon name="mingcute:warning-line" class="text-sm shrink-0 mt-0.5" />
        <div>
          <p class="font-medium">{{ profile.validationSummary ?? 'Ошибка конфигурации' }}</p>
          <button
            class="btn btn-ghost btn-xs text-error p-0 mt-1 h-auto min-h-0"
            @click="emit('validate', profile.id)"
          >
            Проверить снова
          </button>
        </div>
      </div>

      <!-- Schedule badge -->
      <div v-if="profile.scheduleEnabled && profile.scheduleCron" class="flex items-center gap-1 text-xs text-base-content/60">
        <Icon name="mingcute:time-line" class="text-sm" />
        <span>{{ profile.scheduleCron }}</span>
        <span v-if="profile.scheduleNextRunAt" class="text-base-content/40">
          &middot; след: {{ formatDate(profile.scheduleNextRunAt) }}
        </span>
      </div>

      <!-- Last run summary -->
      <div v-if="profile.lastRun" class="flex items-center gap-2 text-xs">
        <span
          class="badge badge-xs"
          :class="runStatusColors[profile.lastRun.status] ?? 'badge-neutral'"
        >
          {{ runStatusLabels[profile.lastRun.status] ?? profile.lastRun.status }}
        </span>
        <span class="text-base-content/50">
          {{ formatDate(profile.lastRun.completedAt ?? profile.lastRun.startedAt) }}
        </span>
        <span v-if="profile.lastRun.importedCount > 0" class="text-success">
          +{{ profile.lastRun.importedCount }}
        </span>
        <button
          class="btn btn-ghost btn-xs p-0 min-h-0 h-auto"
          title="Подробнее"
          @click="emit('showRunDetail', profile.lastRun.id)"
        >
          <Icon name="mingcute:external-link-line" class="text-xs" />
        </button>
      </div>
      <div v-else class="text-xs text-base-content/40 italic">
        Ещё не запускался
      </div>

      <!-- Actions -->
      <div class="card-actions justify-between mt-1">
        <div class="flex gap-1">
          <button
            class="btn btn-ghost btn-xs"
            title="История запусков"
            @click="emit('showRuns', profile.id)"
          >
            <Icon name="mingcute:history-line" class="text-sm" />
          </button>
          <button
            class="btn btn-ghost btn-xs"
            title="Расписание"
            @click="emit('schedule', profile.id)"
          >
            <Icon name="mingcute:time-line" class="text-sm" />
          </button>
          <button
            class="btn btn-ghost btn-xs"
            title="Проверить конфигурацию"
            @click="emit('validate', profile.id)"
          >
            <Icon name="mingcute:shield-check-line" class="text-sm" />
          </button>
          <button
            class="btn btn-ghost btn-xs"
            title="Дублировать"
            @click="emit('duplicate', profile.id)"
          >
            <Icon name="mingcute:copy-2-line" class="text-sm" />
          </button>
        </div>
        <div class="flex gap-1">
          <button
            class="btn btn-ghost btn-xs"
            @click="emit('edit', profile.id)"
          >
            <Icon name="mingcute:edit-line" class="text-sm" />
            Изменить
          </button>
          <button
            class="btn btn-ghost btn-xs text-error"
            @click="emit('delete', profile.id)"
          >
            <Icon name="mingcute:delete-2-line" class="text-sm" />
          </button>
          <button
            class="btn btn-primary btn-xs"
            :disabled="!canLaunch"
            :title="hasConfigError ? 'Исправьте конфигурацию перед запуском' : ''"
            @click="emit('run', profile.id)"
          >
            <span v-if="isActive" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:play-circle-line" class="text-sm" />
            {{ isActive ? 'Работает...' : 'Запустить' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
